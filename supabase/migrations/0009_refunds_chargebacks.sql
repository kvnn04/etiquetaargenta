-- ============================================================================
-- 0009_refunds_chargebacks.sql — REEMBOLSOS Y CONTRACARGOS (posición 13)
-- Fuente única: spec_reembolsos_y_contracargos.md v0.2 (R11.1–R11.10).
-- ----------------------------------------------------------------------------
-- Esta migración es ADITIVA y se corre A MANO en Supabase (el proyecto no usa
-- DATABASE_URL ni migraciones automáticas). No hay DROP TABLE ni pérdida de
-- datos: solo columnas nuevas, constraints de estado ampliados y una tabla de
-- auditoría append-only.
--
--   payments.status          : approved | rejected | refunded |
--                              partially_refunded | charged_back
--   payments.refunded_amount : acumulado devuelto (la app lo clampea a amount)
--   payments.status_detail   : detalle autoritativo de MP (p. ej. refunded)
--   payments.updated_at      : última mutación del pago
--   subscriptions.status     : agrega revocada (reembolso total / contracargo)
--   subscriptions.closure_reason : refund | chargeback | dunning | cancel
--   subscriptions.closed_at  : instante del cierre por revocación
--   payment_adjustments      : auditoría de refund/chargeback/reversal
--
-- Los constraints de estado se buscan por DEFINICIÓN en pg_constraint (no por
-- nombre): una base que nació con otro nombre no falla al insertar `revocada`.
-- Idempotente y re-ejecutable.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1) payments: columnas de reembolso
-- ---------------------------------------------------------------------------
alter table public.payments
  add column if not exists refunded_amount numeric not null default 0,
  add column if not exists status_detail text,
  add column if not exists updated_at timestamptz not null default now();

-- ---------------------------------------------------------------------------
-- 2) payments.status: ampliar la whitelist (R11.2)
--    Se eliminan los CHECK que mencionan `status` y se recrea uno canónico.
-- ---------------------------------------------------------------------------
do $$
declare
  c record;
begin
  for c in
    select conname
      from pg_constraint
     where conrelid = 'public.payments'::regclass
       and contype = 'c'
       and pg_get_constraintdef(oid) like '%status%'
  loop
    execute format('alter table public.payments drop constraint %I', c.conname);
  end loop;

  alter table public.payments
    add constraint payments_status_check
    check (status in (
      'approved',
      'rejected',
      'refunded',
      'partially_refunded',
      'charged_back'
    ));
end $$;

-- ---------------------------------------------------------------------------
-- 3) subscriptions: estado `revocada` + motivo/fecha de cierre (R11.4/R11.6)
-- ---------------------------------------------------------------------------
alter table public.subscriptions
  add column if not exists closure_reason text,
  add column if not exists closed_at timestamptz;

do $$
declare
  c record;
begin
  for c in
    select conname
      from pg_constraint
     where conrelid = 'public.subscriptions'::regclass
       and contype = 'c'
       and pg_get_constraintdef(oid) like '%status%'
  loop
    execute format('alter table public.subscriptions drop constraint %I', c.conname);
  end loop;

  alter table public.subscriptions
    add constraint subscriptions_status_check
    check (status in (
      'inactiva',
      'activa',
      'gracia',
      'programada_cierre',
      'revocada'
    ));
end $$;

-- closure_reason: idempotente aunque la columna ya exista sin CHECK.
do $$
declare
  c record;
begin
  for c in
    select conname
      from pg_constraint
     where conrelid = 'public.subscriptions'::regclass
       and contype = 'c'
       and pg_get_constraintdef(oid) like '%closure_reason%'
  loop
    execute format('alter table public.subscriptions drop constraint %I', c.conname);
  end loop;

  alter table public.subscriptions
    add constraint subscriptions_closure_reason_check
    check (
      closure_reason is null
      or closure_reason in ('refund', 'chargeback', 'dunning', 'cancel')
    );
end $$;

-- ---------------------------------------------------------------------------
-- 4) payment_adjustments: auditoría append-only (R11.7/R11.10)
--    · refund/chargeback/reversal con id de MP cuando exista.
--    · Sin id de MP se deduplica por (mp_payment_id, kind, occurred_at).
--    · El dinero vive en payments; acá queda la NOVEDAD y su origen.
-- ---------------------------------------------------------------------------
create table if not exists public.payment_adjustments (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references public.users (id) on delete cascade,
  mp_payment_id bigint not null,
  kind          text not null check (kind in ('refund', 'chargeback', 'reversal')),
  mp_source_id  text,
  amount        numeric not null default 0,
  raw_status    text,
  occurred_at   timestamptz not null,
  created_at    timestamptz not null default now()
);

create unique index if not exists payment_adjustments_source_idx
  on public.payment_adjustments (kind, mp_source_id)
  where mp_source_id is not null;

create unique index if not exists payment_adjustments_nosource_idx
  on public.payment_adjustments (mp_payment_id, kind, occurred_at)
  where mp_source_id is null;

create index if not exists payment_adjustments_user_idx
  on public.payment_adjustments (user_id, occurred_at desc);

-- ---------------------------------------------------------------------------
-- 5) RLS y GRANTS (misma lección de 0005/0007)
--    · service_role: CRUD (webhook/sync escriben).
--    · authenticated: SELECT solo de SUS filas (Centro de Suscripción).
--    · anon: NADA.
-- ---------------------------------------------------------------------------
alter table public.payment_adjustments enable row level security;

do $$
begin
  create policy payment_adjustments_owner_select on public.payment_adjustments
    for select using (auth.uid() = user_id);
exception
  when duplicate_object then null;
end $$;

grant select, insert, update, delete on public.payment_adjustments
  to service_role;
grant select on public.payment_adjustments to authenticated;

-- ---------------------------------------------------------------------------
-- 6) Comentarios operativos
-- ---------------------------------------------------------------------------
comment on column public.payments.refunded_amount is
  'ARS devueltos acumulados (R11.2). La app lo clampea a amount; nunca supera el cobro.';
comment on column public.payments.status_detail is
  'Detalle autoritativo de MP (status_detail) para el historial y soporte (R11.2).';
comment on column public.payments.updated_at is
  'Última mutación del pago (refund/chargeback incluidos).';
comment on column public.subscriptions.closure_reason is
  'Motivo del cierre (R11.4/R11.6): refund | chargeback | dunning | cancel.';
comment on column public.subscriptions.closed_at is
  'Instante del cierre por reembolso total o contracargo (R11.4/R11.6).';
comment on table public.payment_adjustments is
  'Auditoría append-only de reembolsos, contracargos y reversos (R11.7/R11.10): no reescribe el pago original.';
