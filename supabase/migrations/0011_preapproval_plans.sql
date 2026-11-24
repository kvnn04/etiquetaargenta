-- ============================================================================
-- 0011_preapproval_plans.sql — CHECKOUT CON PLAN DE MERCADO PAGO
-- Fuente: spec_pagos_plan_mp.md (24-nov-2026)
-- ----------------------------------------------------------------------------
-- El checkout PRO deja de crear un preapproval planless con payer_email (MP
-- exige que coincida con la cuenta del pagador y rechaza si no). Ahora crea un
-- preapproval_plan por intento y redirige a su init_point hospedado: MP pide la
-- cuenta del pagador.
--
-- El plan es la CLAVE DE IDENTIDAD local: el webhook puede traer un preapproval
-- sin external_reference, pero siempre trae preapproval_plan_id. Esta tabla
-- mapea plan → usuario y conserva los planes viejos para webhooks tardíos.
--
-- Aditiva e idempotente. El titular la corre a mano en Supabase.
-- ============================================================================

create table if not exists public.mp_preapproval_plans (
  id            text primary key,                 -- preapproval_plan_id de MP
  user_id       uuid not null references public.users (id) on delete cascade,
  amount        numeric not null,                 -- precio del plan al crearlo
  currency      text not null default 'ARS',
  status        text not null default 'active'
                check (status in ('active','cancelled')),
  created_at    timestamptz not null default now(),
  cancelled_at  timestamptz
);

create index if not exists mp_preapproval_plans_user_idx
  on public.mp_preapproval_plans (user_id, created_at desc);

-- Plan vigente del ciclo. Puede quedar NULL en filas viejas (flujo planless).
alter table public.subscriptions
  add column if not exists preapproval_plan_id text;

-- Un plan pertenece a un solo usuario: el checkout crea uno nuevo por intento
-- y cancela el anterior. El índice protege el mapping contra cruces.
create unique index if not exists subscriptions_preapproval_plan_uidx
  on public.subscriptions (preapproval_plan_id)
  where preapproval_plan_id is not null;

-- ---------------------------------------------------------------------------
-- RLS: solo service_role. El cliente jamás necesita leer el mapping de planes.
-- ---------------------------------------------------------------------------
alter table public.mp_preapproval_plans enable row level security;

grant select, insert, update, delete on public.mp_preapproval_plans
  to service_role;

comment on table public.mp_preapproval_plans is
  'Mapping preapproval_plan_id → user_id del checkout PRO con plan (spec_pagos_plan_mp.md). Escritura solo service-role.';
comment on column public.subscriptions.preapproval_plan_id is
  'Plan MP del intento de checkout vigente; el preapproval real llega por webhook.';
