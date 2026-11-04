-- ============================================================================
-- ops/0901_backfill_user_rows.sql — reparación del cartel "No existe fila"
-- ============================================================================
-- Caso: una cuenta de auth.users nació ANTES de correr 0001_auth_skeleton.sql
-- (o el trigger falló en su momento). El trigger SOLO actúa al INSERT; el
-- backfill aplica el MISMO criterio de derivación (handle_new_user, R1 spec
-- registro §3). Idempotente: no toca filas que ya existen. Sin DROPs.
--
-- Ejecutar en el SQL Editor de Supabase. Después: refresh en el editor y el
-- cartel desaparece (chip con el nombre derivado + badge DEMO/Días de gracia ✓).
-- ============================================================================

-- 1) Diagnóstico: ¿qué cuentas quedaron huérfanas?
select u.email, u.created_at
from auth.users u
left join public.users t on t.id = u.id
where t.id is null;

-- 2) Backfill (mismo criterio que el trigger):
--    nombre del perfil de Google si viene; si no, derivado del email.
insert into public.users (id, base_name)
select u.id,
       coalesce(
         nullif(trim(coalesce(u.raw_user_meta_data ->> 'name', '')), ''),
         public.derive_base_name(u.email)
       )
from auth.users u
where not exists (select 1 from public.users t where t.id = u.id);

-- 3) Verificación
select t.id, t.base_name, t.plan, u.email
from public.users t
join auth.users u on u.id = t.id;
