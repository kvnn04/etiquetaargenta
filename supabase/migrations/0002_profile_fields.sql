-- ============================================================================
-- 0002_profile_fields.sql — Posición 2: campos de perfil del taller
-- Fuente: spec_especificaci_n_tecnica_datos_de_usuario_y_registro.md §5 (R2)
-- ----------------------------------------------------------------------------
-- Sin DROPs (no pide confirmación en el SQL editor) y re-ejecutable:
-- add column if not exists + constraints dentro de DO con duplicate_object.
--
-- NOTA sobre email_verified: la spec la enumera, pero se DERIVA de
-- auth.users.email_confirmed_at (fuente única de Supabase Auth — decisión
-- 04-nov). No hay columna duplicada: el drift resulta imposible.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Columnas opcionales del branding (todas NULL-able: la potencia del módulo es
-- la degradación progresiva R3, no va ninguna con NOT NULL).
-- ---------------------------------------------------------------------------
alter table public.users add column if not exists brand_name       text;
alter table public.users add column if not exists logo_url         text;
alter table public.users add column if not exists logo_thumb_url   text;
alter table public.users add column if not exists whatsapp_e164    text;   -- '+54' + dígitos, E.164
alter table public.users add column if not exists instagram_handle text;   -- sin '@', minúsculas
alter table public.users add column if not exists location         text;   -- SOLO perfil interno (R2)
alter table public.users add column if not exists deleted_at       timestamptz; -- R8 soft-delete

-- WhatsApp: dígitos 10–15 TODOS incluido el prefijo (regla §6 R1 usuario).
do $$
begin
  alter table public.users
    add constraint users_whatsapp_e164_format
    check (whatsapp_e164 is null or whatsapp_e164 ~ '^\+[0-9]{10,15}$');
exception
  when duplicate_object then null;
end $$;

-- Instagram: minúsculas canónicas sin '@' (a-z / 0-9 / _ . máx 30, regla §6).
do $$
begin
  alter table public.users
    add constraint users_instagram_format
    check (instagram_handle is null or instagram_handle ~ '^[a-z0-9._]{1,30}$');
exception
  when duplicate_object then null;
end $$;

comment on column public.users.brand_name is
  'Nombre comercial que se imprime en fichas/links (R3). Fallback: base_name o MOCAP.';
comment on column public.users.logo_url is
  'PATH dentro del bucket privado branding (URLS firmadas al render, R4). El crudo nunca persiste.';
comment on column public.users.location is
  'SOLO perfil interno del taller (R2): ningún output lo imprime.';
comment on column public.users.deleted_at is
  'R8 soft-delete: bloquea login con mensaje neutro; soporte restore resta a null dentro de 30 días, luego purge.';

-- ---------------------------------------------------------------------------
-- Purga por antigüedad (R8): la fas real del auth.users a los 30 días de
-- deleted_at queda como operación de soporte — ver supabase/ops/
-- 0920_purge_deleted_accounts.sql (cron manual o pg_cron en el dashboard).
-- ---------------------------------------------------------------------------
