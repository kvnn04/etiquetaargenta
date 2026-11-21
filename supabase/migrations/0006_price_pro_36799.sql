-- ---------------------------------------------------------------------------
-- PRECIO DE LANZAMIENTO PRO — ARS 36.799/mes (21-nov-2026)
-- ---------------------------------------------------------------------------
-- `pricing_config` es de SOLO LECTURA para el backend a propósito (0001): el
-- precio se cambia por migración / SQL Editor, nunca desde la API; por eso la
-- service-role recibe `42501` al intentar un UPDATE.
--
-- Esta migración deja el valor correcto en una base nueva (0001 siembra el
-- precio de ejemplo y acá se corrige) y también en una base existente (el
-- UPDATE es idempotente). No toca suscripciones ya congeladas: `price_frozen`
-- conserva el monto con el que cada taller se dio de alta (R4).
-- ---------------------------------------------------------------------------

update public.pricing_config
set amount = 36799,
    updated_at = now()
where key = 'pro_monthly_ars';
