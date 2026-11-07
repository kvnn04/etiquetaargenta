-- ============================================================================
-- 0005_subscriptions.sql — CICLO DE COBRO (posición 10B del orden)
-- Fuente única: spec_pagos.md §5 (modelo de datos) + §3-R4/R7/R10
--   * subscriptions : detalle del ciclo (preapproval MP, precio congelado R4,
--     ancla del ciclo R1, cierre programado R9).
--   * payments      : historial de cobros con constancia de MP (receipt_url, R6)
--                     y dedupe del webhook por mp_payment_id único (R7).
--   * checkout_intents : SOLO auditoría de abandono de checkout (R10: cero
--     emails de recuperación — única fila para medir conversión a futuro).
--
-- Escrituras SOLO vía webhook/job con service-role (§5: el cliente jamás
-- escribe dinero); lecturas privadas del dueño vía RLS.
--
-- GRANTS INLINE (lección ops/0910, QA 10A): las tablas creadas por SQL editor
-- pueden nacer sin grants ⇒ "permission denied" tragado. BYPASSRLS salta la
-- política pero NO el GRANT: service_role es ESCRITURA aquí (sin policy:
-- nadie más tiene cómo), authenticated SOLO select y el alcance lo fija la
-- policy del dueño.
-- Idempotente y re-ejecutable: create if not exists + DO para policies.
-- ============================================================================

create table if not exists public.subscriptions (
  user_id        uuid primary key references public.users (id) on delete cascade,
  preapproval_id text unique,
  status         text not null default 'inactiva'
                 check (status in ('inactiva','activa','gracia','programada_cierre')),
  price_frozen   numeric not null,   -- ARS congelado al suscribir (R4)
  currency       text not null default 'ARS',
  cycle_anchor   date,               -- día del mes de cobro (R1)
  period_end     timestamptz,        -- fin del ciclo ya pago (programada_cierre, R9)
  grace_expires_at timestamptz,      -- ventana de gracia (R8; espejo del cursor)
  created_at     timestamptz not null default now()
);

-- Idempotencia para bases donde la tabla ya nació sin la columna (proyectos
-- que corrieron la 0005 original): sin esto el reconcile/webhook fallan la lectura.
alter table public.subscriptions add column if not exists grace_expires_at timestamptz;

create table if not exists public.payments (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references public.users (id) on delete cascade,
  mp_payment_id bigint unique not null,   -- dedupe de webhook (R7)
  amount        numeric not null,
  status        text not null check (status in ('approved','rejected')),
  occurred_at   timestamptz not null,
  receipt_url   text,                     -- constancia de Mercado Pago (R6)
  created_at    timestamptz not null default now()
);

create table if not exists public.checkout_intents (
  id     uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id) on delete cascade,
  created_at timestamptz not null default now()
); -- solo auditoría de abandono (R10): sin emails, sin notificaciones

-- Índices de trabajo: historial del centro (desc) y medición de conversión.
create index if not exists payments_user_idx
  on public.payments (user_id, occurred_at desc);
create index if not exists checkout_intents_created_idx
  on public.checkout_intents (created_at);

-- ---------------------------------------------------------------------------
-- RLS: el dueño LEE suscripciones y pagos (Centro de Suscripción); no existen
-- políticas de INSERT/UPDATE/DELETE para clientes ⇒ escritura solo service.
-- checkout_intents: SIN policy ninguna (solo service-role accede; el usuario
-- jamás consulta su falta de conversión).
-- ---------------------------------------------------------------------------
alter table public.subscriptions enable row level security;
alter table public.payments enable row level security;
alter table public.checkout_intents enable row level security;

do $$
begin
  create policy subscriptions_owner_select on public.subscriptions
    for select using (auth.uid() = user_id);
exception
  when duplicate_object then null;
end $$;

do $$
begin
  create policy payments_owner_select on public.payments
    for select using (auth.uid() = user_id);
exception
  when duplicate_object then null;
end $$;

-- ---------------------------------------------------------------------------
-- GRANTS INLINE (lección 10A / ops/0910 — mismas lineas acá a propósito):
--   · service_role: CRUD completo en las 3 — el webhook/job escribe acá.
--   · authenticated: solo SELECT de subscriptions/payments (la policy limita
--     a SUS filas).
--   · anon: NADA (los links públicos no llevan estado de suscripción, §2).
-- ---------------------------------------------------------------------------
grant select, insert, update, delete on public.subscriptions
  to service_role;
grant select, insert, update, delete on public.payments
  to service_role;
grant select, insert, update, delete on public.checkout_intents
  to service_role;

grant select on public.subscriptions to authenticated;
grant select on public.payments to authenticated;

comment on table public.subscriptions is
  'Ciclo de cobro (spec_pagos §5): preapproval MP + price_frozen (grandfathering R4) + ancla del ciclo R1. Escritura solo webhook/job.';
comment on table public.payments is
  'Historial de cobros con constancia MP (receipt_url, R6); dedupe del webhook por mp_payment_id único (R7).';
comment on table public.checkout_intents is
  'Auditoría de abandono de checkout (R10): solo fila de medición — cero emails de recuperación.';
