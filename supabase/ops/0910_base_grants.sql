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
  and table_name in ('users', 'projects', 'pricing_config', 'links', 'link_approvals')
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

-- POS 10A (06-nov): el ciclo de enlaces corre server-side con service-role —
-- publish (ownership + INSERT de la versión, congela state de projects), panel
-- de versiones (links + link_approvals con agregados) y visor /v/[linkId].
-- Misma quirk que motivó este script: `projects` no tenía grant para
-- service_role y `links`/`link_approvals` nacieron SIN grants ⇒
-- "permission denied" TRAGADO por el 404 PROJECT_NOT_FOUND del publish.
-- BYPASSRLS salta la política pero NO el GRANT: sin esto ninguna ruta server
-- llega ni a la RLS. El ALCANCE lo fija el código (eq user_id / RLS), no el grant.
--
-- FIX v2 (mismo día, tras el retry del titular): el primer bloque olvidó
-- EXACTAMENTE el grant que causaba el 404 — el ownership del publish lee
-- `projects` (id + state) con service-role. La fila es SUYA (eq user_id),
-- pero sin el grant ni siquiera llega a evaluarse: permission denied antes
-- de la policy.
grant select on public.projects
  to service_role;

grant select, insert, update, delete on public.links
  to service_role;
grant select on public.link_approvals
  to service_role;
-- POST público de aprobaciones (client ANÓNIMO ⇒ pasa por la policy
-- approvals_public_insert + link_open_for_approval — la DB fija el alcance): 
grant insert on public.link_approvals
  to anon;

grant select on public.pricing_config
  to service_role;

-- 3) Verificación: re-correr el diagnóstico
select table_name, grantee, string_agg(privilege_type, ', ') as privileges
from information_schema.role_table_grants
where table_schema = 'public'
  and table_name in ('users', 'projects', 'pricing_config', 'links', 'link_approvals')
group by table_name, grantee
order by table_name, grantee;
