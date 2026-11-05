-- ============================================================================
-- ops/0910_base_grants.sql — reparación para 'permission denied' en tablas
-- ============================================================================
-- Síntoma: el app responde con el cartel "No existe fila en public.users" o
-- "/api/config/pricing permission denied" AUN cuando las filas existen.
-- Causa típica: proyectos donde los GRANT automáticos de Supabase no cubren
-- las tablas creadas por SQL editor. Estos GRANT son sumativos, idempotentes
-- y NO cambian el alcance: QUÉ filas se alcanzan lo fija la RLS, no los grants.
--
-- Orden: 1o diagnóstico, luego grants, luego verificación.
-- ============================================================================

-- 1) Diagnóstico: ¿quién tiene privilegios hoy?
select table_name, grantee, privilege_type
from information_schema.role_table_grants
where table_schema = 'public'
  and table_name in ('users', 'projects', 'pricing_config')
order by table_name, grantee;

-- 2) Grants base (sin DROP, re-ejecutable — sumativos: no quitan nada previo)
grant usage on schema public to anon, authenticated, service_role;

-- users: /perfil UPDATEa su propia fila (el alcance lo fija RLS own_user_row,
-- no el grant); el SELECT cubre las lecturas server-side del middleware y RSC.
-- QA del panel (04-nov): sin update acá, cada campo moría con
-- "permission denied for table users" ANTES de llegar a la RLS.
grant select, update on public.users
  to authenticated;

-- service_role: rutas de server (logo_url del perfil, plan en pos 8–10).
-- BYPASSRLS salta la política pero NO el GRANT: sin esto la ruta del logo
-- moría en el update de la fila aunque el bucket ya hubiera escrito bien.
grant select, update on public.users
  to service_role;

grant select, insert, update, delete on public.projects
  to authenticated;

grant select on public.pricing_config
  to service_role;

-- 3) Verificación: re-correr el diagnóstico
select table_name, grantee, string_agg(privilege_type, ', ') as privileges
from information_schema.role_table_grants
where table_schema = 'public'
  and table_name in ('users', 'projects', 'pricing_config')
group by table_name, grantee
order by table_name, grantee;
