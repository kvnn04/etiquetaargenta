-- ============================================================================
-- 0007_payment_sync.sql — SYNC DE PAGOS Y RE-VERIFICACIÓN REAL (posición 11)
-- Fuente única: spec_sync_de_pagos_y_reverificacion.md §5 (v0.2, decisiones
-- cerradas el 22-nov-2026).
-- ----------------------------------------------------------------------------
-- Esta migración NO redefine la máquina de estados de spec_pagos.md (R1–R10):
-- agrega el camino de recuperación cuando el webhook no alcanza.
--
--   subscriptions.last_checkout_at : watermark anti-resurrección (R12.4). Lo
--     escribe /api/billing/checkout en cada alta/re-alta.
--   subscriptions.last_synced_at   : lease + TTL del sync (R12.3). Se escribe
--     al INICIO de cada corrida; un fallo de MP no lo borra.
--   payments.applied_at            : marca "este pago ya se foldió al ciclo".
--     NULL + status approved/rejected ⇒ reparable por el próximo sync (R12.6).
--   payments.email_*               : claim atómico del email por pago (R12.7):
--     un solo proceso envía; hasta 3 intentos; el error queda sin PII.
--   payments.source                : auditoría webhook|sync (no cambia R1).
--
-- Número: la spec reservaba 0008 para sync, pero se implementa ANTES que
-- reembolsos/legal ⇒ se renumera a 0007 (regla de la spec: nunca reutilizar
-- un número). Legal quedó en 0008; reembolsos tomará 0009.
--
-- Idempotente y re-ejecutable: add column if not exists + create index if not
-- exists. Los grants existentes de 0005 cubren las columnas nuevas (GRANT es
-- por tabla, no por columna); no se agregan policies ni escrituras cliente.
-- ============================================================================

alter table public.subscriptions
  add column if not exists last_checkout_at timestamptz,
  add column if not exists last_synced_at timestamptz;

-- Backfill de las filas nacidas en 10B: antes de esta migración NO existía
-- `applied_at`, y esos pagos ya se habían foldido al ciclo por el webhook.
-- Marcarlos evita que el primer sync re-aplique pagos históricos (posible
-- resurrección) y reenvíe recibos viejos. El DO corre SOLO la primera vez
-- (cuando `applied_at` todavía no existe): una re-ejecución de la migración
-- no debe "aplicar" pagos nuevos que estén pendientes de reparación.
do $$
begin
  if not exists (
    select 1
      from information_schema.columns
     where table_schema = 'public'
       and table_name = 'payments'
       and column_name = 'applied_at'
  ) then
    alter table public.payments add column if not exists applied_at timestamptz;
    alter table public.payments add column if not exists email_sent_at timestamptz;
    update public.payments
       set applied_at = occurred_at,
           email_sent_at = occurred_at
     where applied_at is null;
  end if;
end $$;

alter table public.payments
  add column if not exists applied_at timestamptz,
  add column if not exists email_sent_at timestamptz,
  add column if not exists email_claimed_at timestamptz,
  add column if not exists email_attempts integer not null default 0,
  add column if not exists email_last_error text,
  add column if not exists source text not null default 'webhook'
    check (source in ('webhook','sync'));

-- Índice de reparación: pagos pendientes de foldear al ciclo, en orden.
create index if not exists payments_pending_apply_idx
  on public.payments (user_id, occurred_at)
  where applied_at is null;

-- Índice del watermark cuando todavía no existe fila subscriptions (R12.4).
create index if not exists checkout_intents_user_created_idx
  on public.checkout_intents (user_id, created_at desc);

comment on column public.subscriptions.last_checkout_at is
  'Watermark anti-resurrección (R12.4): último checkout iniciado. Un pago anterior a esto − 1 día se audita pero no muta el plan.';
comment on column public.subscriptions.last_synced_at is
  'Lease/TTL del sync de pagos (R12.3): 60 s on-read no activo, 6 h activo, 20 s manual.';
comment on column public.payments.applied_at is
  'NULL + status approved/rejected ⇒ pago reparable por el próximo sync (R12.6). Se marca solo cuando ciclo y users.plan quedaron consistentes.';
comment on column public.payments.email_claimed_at is
  'Lease de envío del email por pago (R12.7): evita que webhook y sync manden dos veces. Vence a los 5 min.';
comment on column public.payments.email_sent_at is
  'Marca final del email por pago (recibo o aviso de gracia) — R12.7.';
comment on column public.payments.email_attempts is
  'Intentos de email (máx 3). Si falta RESEND_API_KEY/EMAIL_FROM NO se incrementa.';
comment on column public.payments.source is
  'Origen del registro: webhook (camino primario) o sync (recuperación/auditoría).';
