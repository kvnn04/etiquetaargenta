-- ============================================================================
-- 0008_legal.sql — PÁGINAS LEGALES, ACEPTACIÓN Y DERECHOS DEL CONSUMIDOR
-- Posición 12 del orden. Fuente única: spec_paginas_legales.md §5 + R13.1–R13.16.
-- ----------------------------------------------------------------------------
-- Norma vigente: Disposición 954/2025 (B.O. 04/09/2025), que derogó las
-- Resoluciones 424/2020 y 316/2018 y unificó el BOTÓN DE ARREPENTIMIENTO y el
-- BOTÓN DE BAJA DE SERVICIO. Se complementa con Ley 24.240 (arts. 10 ter/34),
-- Ley 25.326 y arts. 1.110/1.116 del CCyC.
--
--   * legal_acceptances : evidencia VERSIONADA de términos/privacidad aceptados
--     en el checkout (R13.7/R13.8). Las versiones viejas NUNCA se borran.
--   * legal_requests    : solicitudes públicas sin login (arrepentimiento, baja,
--     derechos de datos). La baja usa doble opt-in: token hasheado de 24 h y
--     un solo uso (R13.6). El código se muestra en pantalla y se manda por email.
--
-- Escrituras SOLO service-role (§5: legal_requests no tiene policies públicas).
-- El dueño únicamente puede LEER sus propias aceptaciones.
-- Idempotente y SIN operaciones destructivas: create if not exists + DO para
-- policies/constraints. Puede re-correse sin romper nada.
-- ============================================================================

create extension if not exists pgcrypto; -- gen_random_uuid()

-- ---------------------------------------------------------------------------
-- 1. Evidencia de aceptación (checkout / signup / reacceptance)
-- ---------------------------------------------------------------------------
create table if not exists public.legal_acceptances (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid references public.users (id) on delete set null,
  email       text,                 -- snapshot de evidencia si se borra la cuenta
  document    text not null check (document in ('terms','privacy')),
  version     text not null,
  context     text not null default 'checkout'
              check (context in ('checkout','signup','reacceptance')),
  accepted_at timestamptz not null default now(),
  ip          inet,
  user_agent  text,
  unique (user_id, document, version, context)
);

create index if not exists legal_acceptances_user_idx
  on public.legal_acceptances (user_id, accepted_at desc);
create index if not exists legal_acceptances_doc_idx
  on public.legal_acceptances (document, version);

-- ---------------------------------------------------------------------------
-- 2. Solicitudes públicas (arrepentimiento / baja / privacidad)
-- ---------------------------------------------------------------------------
create table if not exists public.legal_requests (
  id                uuid primary key default gen_random_uuid(),
  code              text unique not null,
  kind              text not null
                    check (kind in ('arrepentimiento','baja','privacidad')),
  email             text not null,          -- normalizado (trim + lower)
  full_name         text,
  user_id           uuid references public.users (id) on delete set null,
  mp_payment_id     bigint,
  mp_preapproval_id text,
  purchase_date     date,
  data_right        text
                    check (data_right is null or
                           data_right in ('acceso','rectificacion','supresion','oposicion')),
  message           text,
  status            text not null default 'recibida'
                    check (status in ('recibida','en_proceso','resuelta','rechazada')),
  resolution_note   text,
  ip_hash           text,
  confirmation_token_hash   text,
  confirmation_expires_at   timestamptz,
  confirmed_at      timestamptz,
  created_at        timestamptz not null default now(),
  responded_at      timestamptz
);

-- Columnas agregadas a una tabla que ya hubiera nacido en una corrida previa.
alter table public.legal_requests
  add column if not exists purchase_date date;
alter table public.legal_requests
  add column if not exists data_right text;
alter table public.legal_requests
  add column if not exists confirmation_token_hash text;
alter table public.legal_requests
  add column if not exists confirmation_expires_at timestamptz;
alter table public.legal_requests
  add column if not exists confirmed_at timestamptz;

create index if not exists legal_requests_email_idx
  on public.legal_requests (email, created_at desc);
create index if not exists legal_requests_ip_idx
  on public.legal_requests (ip_hash, created_at desc);
create index if not exists legal_requests_kind_idx
  on public.legal_requests (kind, status, created_at desc);
create unique index if not exists legal_requests_confirmation_idx
  on public.legal_requests (confirmation_token_hash)
  where confirmation_token_hash is not null;

-- ---------------------------------------------------------------------------
-- 3. RLS + GRANTS INLINE (lección ops/0910)
--   · service_role: CRUD en ambas tablas (rutas legales, checkout, webhook).
--   · authenticated: SOLO SELECT de SUS aceptaciones (la policy lo limita).
--   · anon: NADA. legal_requests se lee/escribe solo con service role.
-- ---------------------------------------------------------------------------
alter table public.legal_acceptances enable row level security;
alter table public.legal_requests enable row level security;

do $$
begin
  create policy legal_acceptances_owner_select on public.legal_acceptances
    for select using (auth.uid() = user_id);
exception
  when duplicate_object then null;
end $$;

grant select, insert, update, delete on public.legal_acceptances
  to service_role;
grant select, insert, update, delete on public.legal_requests
  to service_role;

grant select on public.legal_acceptances to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Búsqueda de cuenta por email para la baja (R13.6): la tabla pública
-- `users` NO tiene email; `auth.users` no está expuesto al cliente JS. Esta
-- función SECURITY DEFINER devuelve SOLO el uuid y se ejecuta ÚNICAMENTE con
-- service_role. Nunca se expone a anon/authenticated.
-- ---------------------------------------------------------------------------
create or replace function public.legal_find_user_by_email(p_email text)
returns uuid
language sql
security definer
set search_path = auth, public
as $$
  select id
  from auth.users
  where lower(email) = lower(btrim(p_email))
  limit 1
$$;

revoke all on function public.legal_find_user_by_email(text) from public;
revoke all on function public.legal_find_user_by_email(text) from anon;
revoke all on function public.legal_find_user_by_email(text) from authenticated;
grant execute on function public.legal_find_user_by_email(text) to service_role;

-- ---------------------------------------------------------------------------
-- 5. Comentarios de operación
-- ---------------------------------------------------------------------------
comment on table public.legal_acceptances is
  'Evidencia versionada de aceptación de Términos/Privacidad (R13.7/R13.8). Escritura solo service-role; el dueño lee sus filas.';
comment on table public.legal_requests is
  'Solicitudes públicas de arrepentimiento/baja/derechos (R13.4–R13.6/R13.10). Sin policies públicas: solo service-role.';
comment on column public.legal_requests.ip_hash is
  'SHA-256 con salt del server, solo rate limit; no se guarda la IP cruda (R13.15).';
comment on column public.legal_requests.confirmation_token_hash is
  'SHA-256 del token de baja; el token crudo vive solo en el email y vence a las 24 h (R13.6).';
