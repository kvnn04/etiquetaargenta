-- ============================================================================
-- 0001_auth_skeleton.sql — Esqueleto de Auth (posición 1 del orden)
-- Fuente de cada pieza:
--   * users (plan/grace/preapproval)  → spec_autenticacion_y_modelo_freemium.md §5
--   * Nombre derivado + 'MI TALLER'    → spec_especificaci_n_tecnica_...  §3-R1
--   * projects / RLS / autosave shape  → spec_tipo_de_mate.md §5
--   * pricing_config única fila        → spec_pagos.md §5-R3
-- Idempotente y SIN operaciones destructivas: nada de DROP (las políticas y
-- triggers nacen dentro de bloques DO con captura de duplicate_object; las
-- funciones van con create or replace). Puede re-corrirse sin romper nada.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- users — la fuente del plan (matriz R2). El rol vive acá; el claim del JWT
-- es cache no autoritativa (R1 de spec_auth).
-- ---------------------------------------------------------------------------
create table if not exists public.users (
  id               uuid primary key references auth.users (id) on delete cascade,
  base_name        text not null default 'MI TALLER',
  plan             text not null default 'free' check (plan in ('free','pro','pro_grace')),
  grace_expires_at timestamptz,
  mp_preapproval_id text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

alter table public.users enable row level security;

-- Grants base: algunos proyectos de Supabase NO aplican los grant automáticos
-- a tablas creadas desde SQL editor (se ve 'permission denied for table users'
-- aun con la RLS bien). Aclara privilegios; la política own_user_row sigue
-- siendo quien decide qué filas alcanza.
grant select on public.users to anon, authenticated;

-- Solo el dueño lee/escribe su propia fila (las demás specs citan esta RLS).
do $$
begin
  create policy "own_user_row" on public.users
    for all using (auth.uid() = id) with check (auth.uid() = id);
exception
  when duplicate_object then null;  -- ya existe: no-op
end $$;

comment on table public.users is
  'Fuente de permisos (matriz R2). plan vive acá; el JWT es cache no autoritativa (spec_autenticacion_y_modelo_freemium §3).';

-- ---------------------------------------------------------------------------
-- Nombre derivado (R1 spec de usuario):  kevin.firma@x.com ⇒ "Kevin Firma".
-- Inutilizable (solo números, vacío) ⇒ "MI TALLER" (regla R1).
-- ÚNICA implementación: DB trigger; el cliente no re-deriva.
-- ---------------------------------------------------------------------------
create or replace function public.derive_base_name(p_email text)
returns text
language plpgsql
immutable
as $$
declare
  local_part text;
  words      text[];
  word       text;
  result     text;
begin
  local_part := lower(coalesce(split_part(coalesce(p_email, ''), '@', 1), ''));
  -- separadores de email → espacios
  local_part := regexp_replace(local_part, '[._\-+]+', ' ', 'g');
  words := regexp_split_to_array(trim(local_part), '\s+');

  result := '';
  for i in 1 .. coalesce(array_length(words, 1), 0) loop
    word := words[i];
    -- conservar solo tokens alfabéticos de 2+ letras (descarta números/glitches)
    continue when word is null or word = '' or word !~ '^[a-z]{2,}$';
    result := result || (case when result = '' then '' else ' ' end) || initcap(word);
  end loop;

  if result is null or result = '' then
    return 'MI TALLER';
  end if;
  return result;
end;
$$;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  derived text;
begin
  -- Con Google: viene el nombre real del perfil; si no, se deriva del email.
  if coalesce(new.raw_user_meta_data ->> 'name', '') <> '' then
    derived := trim(new.raw_user_meta_data ->> 'name');
  else
    derived := public.derive_base_name(new.email);
  end if;

  insert into public.users (id, base_name)
  values (new.id, coalesce(nullif(trim(derived), ''), 'MI TALLER'))
  on conflict (id) do nothing;

  return new;
end;
$$;

-- Trigger al crear un usuario (auth.users). Sin DROP: si ya existe, no-op.
do $$
begin
  create trigger on_auth_user_created
    after insert on auth.users
    for each row execute function public.handle_new_user();
exception
  when duplicate_object then null;
end $$;

-- ---------------------------------------------------------------------------
-- projects: snapshot completo del editor (documento la home de persistencia de
-- la matriz R2; el autosave con debounce 2 s llega en la posición 3).
-- ---------------------------------------------------------------------------
create table if not exists public.projects (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  title       text not null default 'Mate sin título',
  state       jsonb not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

alter table public.projects enable row level security;

-- El dueño es el único que accede (RLS own_projects); el grant permita el paso
-- por la puerta, el alcance lo fija la política.
grant select, insert, update, delete on public.projects to authenticated;

do $$
begin
  create policy "own_projects" on public.projects
    for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
exception
  when duplicate_object then null;
end $$;

-- ---------------------------------------------------------------------------
-- pricing_config: precio del plan servido por el backend (spec_pagos R3).
-- RLS cerrada por defecto: la lectura la hace el server con service role
-- (por eso /api/config/pricing exige SUPABASE_SERVICE_ROLE_KEY).
-- ---------------------------------------------------------------------------
create table if not exists public.pricing_config (
  key        text primary key,
  amount     numeric not null,
  currency   text not null default 'ARS',
  updated_at timestamptz not null default now()
);

alter table public.pricing_config enable row level security;

-- Solo service role leerla (el server del precio). jamás anon/authenticated.
grant select on public.pricing_config to service_role;

-- Valor inicial de ejemplo: el responsable lo ajusta desde Supabase
-- (el paywall SIEMPRE imprime el precio leído del backend, nunca hardcodeado).
insert into public.pricing_config (key, amount, currency)
values ('pro_monthly_ars', 20000, 'ARS')
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- Touch de updated_at para users/projects (autosave last-write-wins).
-- ---------------------------------------------------------------------------
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

do $$
begin
  create trigger users_touch_updated
    before update on public.users
    for each row execute function public.touch_updated_at();
exception
  when duplicate_object then null;
end $$;

do $$
begin
  create trigger projects_touch_updated
    before update on public.projects
    for each row execute function public.touch_updated_at();
exception
  when duplicate_object then null;
end $$;

-- ---------------------------------------------------------------------------
-- Realtime de users: sin reload — cuando el webhook cambie users.plan,
-- todas las pestañas abiertas se actualizan (R6 de spec_auth).
-- Requiere además activar la replicación de la tabla en el dashboard
-- (Database → Replication → public.users) si no la toma por publicación.
-- ---------------------------------------------------------------------------
do $$
begin
  execute 'alter publication supabase_realtime add table public.users';
exception
  when duplicate_object then null;
  when undefined_object then null;
end $$;
