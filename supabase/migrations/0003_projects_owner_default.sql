-- ============================================================================
-- 0003_projects_owner_default.sql — DEFAULT de user_id en projects
-- ----------------------------------------------------------------------------
-- Síntoma destapado por el QA real de la posición 3: el autosave insertaba
-- { state } y la política own_projects (with check: auth.uid() = user_id)
-- rechazaba la fila nueva con "new row violates row-level security policy",
-- porque la columna user_id no tenía default y la app no envía ese campo.
-- El restore (SELECT) funcionaba: se cayó solo en el INSERT.
--
-- Fix: patrón canónico de Supabase para filas por-sesión — user_id con
-- default auth.uid(). El cliente nunca declara user_id (jamás confiar en el
-- body), la DB lo completa con la sesión vigente y el WITH CHECK de la
-- política sigue siendo la última palabra.
--
-- Fuente de cada pieza:
--   * projects (snapshot del editor + autosave debounce 2 s) → spec_tipo_de_mate.md §5
--   * Matriz de acceso por dueño (RLS strict, sin cambios de alcance) → spec_auth §3-R2
--
-- ADITIVO y re-ejecutable: solo SET DEFAULT (nada de DROP ni ALTER TYPE).
-- ============================================================================

alter table public.projects
  alter column user_id set default auth.uid();

-- Verificación (copiable en el SQL Editor):
--
--   select column_default from information_schema.columns
--    where table_schema = 'public' and table_name = 'projects'
--      and column_name = 'user_id';
--   -- esperado: "auth.uid()"
--
-- Con sesión activa, el próximo cambio en el editor deja de logear
-- "[projects] save:" (RLS) y confirma con el chip "Guardado HH:MM".
