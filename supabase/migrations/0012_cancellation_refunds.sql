-- ============================================================================
-- 0012_cancellation_refunds.sql — ARREPENTIMIENTO CON REEMBOLSO TOTAL
-- ----------------------------------------------------------------------------
-- Fuente: decisión del titular (2026-11-27) + spec_pagos.md R9 +
-- spec_reembolsos_y_contracargos.md R11.5/R13.5.
--
-- Esta migración es ADITIVA y se corre A MANO en Supabase (el proyecto no usa
-- DATABASE_URL ni migraciones automáticas). No hay DROP TABLE ni pérdida de
-- datos.
--
--   refund_requests : auditoría e idempotencia de CADA intento de reembolso
--                     iniciado por el Botón de Arrepentimiento (withdrawal).
--                     `cancellation` se conserva para filas históricas de la
--                     baja inmediata retirada el 2026-11-27.
--
-- Reglas que sostiene la tabla:
--   · una sola solicitud ACTIVA por (user_id, mp_payment_id): pending,
--     processing o approved. Un segundo click no puede reembolsar dos veces.
--   · la `idempotency_key` se manda a MP como X-Idempotency-Key y se reutiliza
--     en cada reintento: un fetch repetido devuelve el mismo reembolso.
--   · `applied_at` NULL + status approved ⇒ MP devolvió el dinero pero falta
--     converger el estado local; el webhook/sync lo repara.
--   · `email_sent_at` es el claim del email de arrepentimiento+reembolso: un
--     solo envío por solicitud, aunque el webhook y la API corran a la vez.
-- ============================================================================

create table if not exists public.refund_requests (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null references public.users (id) on delete cascade,
  mp_payment_id      bigint not null,
  -- Origen de la solicitud: `withdrawal` (Botón de Arrepentimiento) o
  -- `cancellation` (fila histórica de la baja inmediata retirada).
  kind               text not null check (kind in ('cancellation', 'withdrawal')),
  -- full = 100 % del saldo (única modalidad vigente); partial = histórico.
  refund_kind        text not null check (refund_kind in ('full', 'partial')),
  status             text not null default 'pending'
                     check (status in ('pending', 'processing', 'approved', 'failed')),
  idempotency_key    text not null unique,
  amount             numeric not null default 0,
  payment_amount     numeric not null default 0,
  refunded_before    numeric not null default 0,
  days_since_payment integer,
  days_remaining     integer,
  cycle_days         integer,
  mp_refund_id       text,
  mp_status          text,
  error_detail       text,
  legal_request_id   uuid references public.legal_requests (id) on delete set null,
  requested_at       timestamptz not null default now(),
  completed_at       timestamptz,
  applied_at         timestamptz,
  email_claimed_at   timestamptz,
  email_sent_at      timestamptz,
  email_last_error   text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

-- Una sola solicitud ACTIVA por pago. `failed` queda fuera: el reintento
-- reutiliza la misma fila y la misma idempotency key, no crea otra.
create unique index if not exists refund_requests_active_idx
  on public.refund_requests (user_id, mp_payment_id)
  where status in ('pending', 'processing', 'approved');

create index if not exists refund_requests_user_idx
  on public.refund_requests (user_id, created_at desc);

create index if not exists refund_requests_payment_idx
  on public.refund_requests (mp_payment_id);

-- ---------------------------------------------------------------------------
-- RLS y GRANTS (misma lección de 0005/0009)
--   · service_role: CRUD (la API y el webhook escriben).
--   · authenticated: SELECT solo de SUS filas (Centro de Suscripción).
--   · anon: NADA.
-- ---------------------------------------------------------------------------
alter table public.refund_requests enable row level security;

do $$
begin
  create policy refund_requests_owner_select on public.refund_requests
    for select using (auth.uid() = user_id);
exception
  when duplicate_object then null;
end $$;

grant select, insert, update, delete on public.refund_requests
  to service_role;
grant select on public.refund_requests to authenticated;

-- ---------------------------------------------------------------------------
-- Comentarios operativos
-- ---------------------------------------------------------------------------
comment on table public.refund_requests is
  'Auditoría e idempotencia del reembolso total del Botón de Arrepentimiento (≤ 10 días). Una solicitud activa por pago; `cancellation` es histórico.';
comment on column public.refund_requests.idempotency_key is
  'X-Idempotency-Key enviada a MP. Se reutiliza en cada reintento para no devolver dos veces.';
comment on column public.refund_requests.applied_at is
  'NULL con status approved ⇒ MP devolvió el dinero pero falta converger payments/subscriptions/users.';
comment on column public.refund_requests.email_sent_at is
  'Claim del email de arrepentimiento+reembolso: un solo envío por solicitud.';
