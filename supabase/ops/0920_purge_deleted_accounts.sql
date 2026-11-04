-- ============================================================================
-- ops/0920_purge_deleted_accounts.sql — R8 del spec registro (retención)
-- ----------------------------------------------------------------------------
-- Dos operaciones de SOPORTE (requieren una verificación fuera de la app que
-- el solicitante es el MISMO email: un mail a la casilla bloqueada):
--
--   1. RESTAURAR (dentro de los 30 días): limpiar el deleted_at de la fila.
--   2. PURGAR (al cumplirse los 30 días): borrar el auth user REAL
--      — el on delete cascade se encarga de public.users y de todo lo demás.
--
-- En el dashboard esto se puede programar con pg_cron (Database → Extensions
-- → cron) o corriendo el bloque PURGA manualmente cada semana. Sin DROPs;
-- ambos bloques re-ejecutables.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1) DIAGNÓSTICO: filas pendientes (¿cuánto les queda de ventana?)
-- ---------------------------------------------------------------------------
select t.id,
       u.email,
       t.deleted_at,
       (t.deleted_at + interval '30 days') as fecha_purga,
       (t.deleted_at + interval '30 days' > now()) as dentro_de_ventana
from public.users t
join auth.users u on u.id = t.id
where t.deleted_at is not null
order by t.deleted_at;

-- ---------------------------------------------------------------------------
-- 2) RESTAURAR UNA CUENTA (a pedido verificado del mismo email, ≤ 30 días)
--    Reemplaza el UUID/E-MAIL below. La eliminación de proyectos ya fue
--    inmediata: se restaura la Cuenta, no el contenido borrado.
-- ---------------------------------------------------------------------------
-- update public.users set deleted_at = null where id = '<uuid-del-usuario>';

-- ---------------------------------------------------------------------------
-- 3) PURGA FINAL (cron sugerido: 0 4 * * * — una vez por día a la noche)
--    Borrar auth.users hace CASCADE de public.users (FK de 0001) y de
--    proyectos/links/assets futuros. Las sesiones y el storage quedan
--    sin dueño: el bucket de branding también se limpia abajo.
-- ---------------------------------------------------------------------------
do $$
declare
  rec record;
begin
  for rec in
    select t.id from public.users t
    where t.deleted_at is not null
      and t.deleted_at + interval '30 days' <= now()
  loop
    delete from storage.objects
      where storage.objects.bucket_id = 'branding'
        and storage.objects.name like rec.id || '/%';
    delete from auth.users where id = rec.id;  -- cascade: users + projects…
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 4) VERIFICACIÓN: debiera quedar solo lo no-purgado aún dentro de ventana
-- ---------------------------------------------------------------------------
select count(*) as filas_eliminadas_pendientes
from public.users where deleted_at is not null;
