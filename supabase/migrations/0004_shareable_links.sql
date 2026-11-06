-- ============================================================================
-- 0004_shareable_links.sql — LINKS COMERCIALES + APROBACIONES (posición 10A)
-- ----------------------------------------------------------------------------
-- FUENTE ÚNICA: spec_ficha_comercial_interactiva_shareable_link.md §5 (modelo
-- de datos) + §3 (reglas R1–R8) + §6 (seguridad). Primera tabla nueva desde
-- 0003: los links son REGISTROS VERSIONADOS aparte — el snapshot del editor
-- sigue en projects.state (spec R1: "el proyecto y su estado siguen en
-- projects.state; el link es un registro aparte por versión").
--
-- R1 versionado inmutable: cada regeneración INSERTA una fila nueva (linkId
--    distinto); las previas quedan intactas → NUNCA existe UPDATE de payload.
-- R2 linkId: 6 caracteres [a-z0-9] — CHECK de formato como última defensa
--    (el generador con reintentos de colisión vive en lib/links/identity.ts).
-- R4 payload schemaVersion 2 — jsonb sin forma restringida en SQL: la
--    validación del schema la hace el server al publicar (lib/links/payload.ts).
--
-- ORDEN DEL ARCHIVO (lección del QA real): las funciones security-definer van
-- ANTES de las policies — CREATE POLICY resuelve al CREAR (no al evaluar) las
-- funciones de su USING / WITH CHECK. Referenciar una función de más abajo
-- falla con 42883.
-- ============================================================================

create table if not exists public.links (
  link_id        text primary key
                 check (link_id ~ '^[a-z0-9]{6}$'),   -- R2 (alfabeto canónico)
  project_id     uuid not null references public.projects (id) on delete cascade,
  user_id        uuid not null references public.users (id) on delete cascade,
  version        int  not null default 1,
  payload        jsonb not null,                      -- schemaVersion 2 (R4)
  created_at     timestamptz not null default now(),
  expires_at     timestamptz not null,                -- created_at + 30 días (R5)
  created_by_pro boolean not null default false
);

create table if not exists public.link_approvals (
  id          uuid primary key default gen_random_uuid(), -- id surrogate (la spec no lo traía)
  link_id     text not null references public.links (link_id) on delete cascade,
  variant_id  text not null check (char_length(variant_id) between 1 and 3), -- 'A' | 'B' | 'C'
  approved_at timestamptz not null default now(),
  user_agent  text
);

-- Listado de versiones del editor: por proyecto, la más nueva primero.
create index if not exists links_project_created_idx
  on public.links (user_id, project_id, created_at desc);

-- Badge "APROBADO Opción B": la última aprobación por link (R6, acumulables).
create index if not exists link_approvals_link_idx
  on public.link_approvals (link_id, approved_at desc);

-- ============================================================================
-- RLS — §5/§6 de la spec:
--   · links: el DUEÑO lee sus versiones (gestión). La lectura pública del
--     registro se resuelve SERVER-SIDE (visor /v/[linkId] = server component
--     con service-role): más estricto que la vista pública de la spec — el
--     payload jamás sale del server y la tabla no es anon-legible. DESVIACIÓN
--     declarada de la "vista segura" por seguridad equivalente o mayor.
--   · link_approvals: INSERT público (el cliente aprueba sin sesión) con
--     WITH CHECK via función security-definer: el link debe existir Y estar
--     vigente. SELECT/UPDATE/DELETE jamás para anon/authenticated.
--   · Publicar (INSERT en links) SOLO via service-role: no hay policy de
--     insert, la cuenta del taller jamás escribe directo (R8 server-side).
-- ============================================================================

alter table public.links enable row level security;
alter table public.link_approvals enable row level security;

-- ============================================================================
-- FUNCIONES PREDICADO (security-definer) — el anon no puede SELECT en links:
-- la subconsulta corre con los derechos del owner de la función. Van ANTES de
-- las policies que las citan (ver nota de orden arriba).
-- ============================================================================
create or replace function public.link_open_for_approval(p_link_id text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.links
    where link_id = p_link_id and expires_at > now()
  );
$$;

grant execute on function public.link_open_for_approval(text) to anon, authenticated;

-- POLICIES -------------------------------------------------------------------
drop policy if exists links_owner_select on public.links;
create policy links_owner_select
  on public.links
  for select to authenticated
  using (user_id = auth.uid());

drop policy if exists approvals_public_insert on public.link_approvals;
create policy approvals_public_insert
  on public.link_approvals
  for insert to anon, authenticated
  with check (public.link_open_for_approval(link_id));

-- El dueño NO borra versiones (R1: inmutables; la purga de expiradas la hace
-- el job de Storage por service-role) y NO las edita (payload congelado).
revoke update, delete on public.links from anon, authenticated;
revoke select, update, delete on public.link_approvals from anon, authenticated;

-- ============================================================================
-- STORAGE — §5 de la spec:
--   · link-assets (PÚBLICO de lectura): las texturas congeladas las baja el
--     cliente sin sesión. path: {linkId}/design.{ext} — las 3 variantes
--     comparten EL MISMO diseño (decisión del titular 10A: las variantes son
--     configs rotación/escala/espejo del mismo archivo).
--   · designs (PRIVADO): el archivo ORIGINAL del grabado persistido por
--     proyecto (decisión del titular 10A: regenerar versiones futuras sin
--     recargar el archivo). path: {userId}/{projectId}.{ext}. Server-only.
--   · CARGAS: solo service-role (ninguna policy de Storage para cliente).
--     La re-encodación ≤1024² ≤300 KB vive en el cliente (canvas) y el server
--     re-valida bytes; el visor re-encoda también (defensa en profundidad §6).
-- ============================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('link-assets', 'link-assets', true, 2097152,
   array['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml']),
  ('designs', 'designs', false, 10485760,
   array['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml'])
on conflict (id) do update
  set public             = excluded.public,
      file_size_limit    = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- ============================================================================
-- Verificación (copiable en el SQL Editor):
--
--   select id, public, file_size_limit from storage.buckets
--    where id in ('link-assets', 'designs');
--   -- esperado: link-assets public=true · designs public=false
--
--   select pol.polname, pol.polcmd from pg_policy pol
--    join pg_class rel on rel.oid = pol.polrelid
--    where rel.relname in ('links', 'link_approvals');
--   -- esperado: links_owner_select (select) · approvals_public_insert (insert)
--
--   select public.link_open_for_approval('zzzzzz');
--   -- esperado: false (link inexistente)
--
--   · Con sesión del taller: un SELECT en links lista SUS versiones; un anon
--     SELECT devuelve 0 filas (tabla opaca sin sesión).
--   · Un INSERT de aprobación sobre link inexistente/vencido ⇒ RECHAZADO por
--     la policy (link_open_for_approval = false — el route igual valida antes).
-- ============================================================================
