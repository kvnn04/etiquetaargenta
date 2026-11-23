-- ============================================================================
-- 0010_link_responses.sql — DECISIÓN Y OBSERVACIONES DEL CLIENTE (posición 14)
-- ----------------------------------------------------------------------------
-- FUENTE ÚNICA: spec_decision_y_observaciones_del_cliente.md
--   R14.1 una decisión inmutable por link
--   R14.3 rechazo con observación obligatoria
--   R14.4 una observación por link (sola o como motivo del rechazo)
--   R14.5 canales email/whatsapp
--   R14.13 legacy: link_approvals cuenta como aprobación y bloquea decisión
--
-- Una fila por link. Decisión y observación son campos independientes; cada
-- grupo se escribe UNA sola vez. Toda lectura/escritura pasa por service-role:
-- la tabla no tiene policies públicas. Las RPCs son security-definer y solo
-- las puede ejecutar service_role.
--
-- Se aplica A MANO en el SQL Editor de Supabase (no hay DATABASE_URL), como
-- 0007–0009. Idempotente: create table/if not exists + create or replace.
-- ============================================================================

create table if not exists public.link_responses (
  link_id                   text primary key references public.links (link_id) on delete cascade,
  decision                  text check (decision is null or decision in ('approved', 'rejected')),
  decision_variant_id       text check (decision_variant_id is null or decision_variant_id in ('A', 'B', 'C')),
  decided_at                timestamptz,
  decision_channel          text check (decision_channel is null or decision_channel in ('email', 'whatsapp')),
  decision_user_agent       text,
  decision_email_sent_at    timestamptz,
  decision_email_error      text,
  observation               text check (observation is null or char_length(observation) between 1 and 280),
  observed_at               timestamptz,
  observation_channel       text check (observation_channel is null or observation_channel in ('email', 'whatsapp')),
  observation_user_agent    text,
  observation_email_sent_at timestamptz,
  observation_email_error   text,
  created_at                timestamptz not null default now(),

  constraint link_responses_decision_pair
    check ((decision is null) = (decided_at is null)),
  constraint link_responses_decision_variant_pair
    check ((decision is null) = (decision_variant_id is null)),
  constraint link_responses_rejected_needs_observation
    check (decision is distinct from 'rejected' or observation is not null),
  constraint link_responses_rejected_needs_channel
    check (decision is distinct from 'rejected' or decision_channel is not null),
  constraint link_responses_approved_no_channel
    check (decision is distinct from 'approved' or decision_channel is null),
  constraint link_responses_observation_pair
    check ((observation is null) = (observed_at is null)),
  constraint link_responses_observation_channel_pair
    check ((observation is null) = (observation_channel is null)),
  constraint link_responses_not_empty
    check (decision is not null or observation is not null),
  constraint link_responses_decision_whatsapp_no_email
    check (
      decision_channel is distinct from 'whatsapp'
      or (decision_email_sent_at is null and decision_email_error is null)
    ),
  constraint link_responses_observation_whatsapp_no_email
    check (
      observation_channel is distinct from 'whatsapp'
      or (observation_email_sent_at is null and observation_email_error is null)
    ),
  constraint link_responses_decision_email_needs_decision
    check (decision_channel is distinct from 'email' or decision is not null),
  constraint link_responses_observation_email_needs_observation
    check (observation_channel is distinct from 'email' or observation is not null)
);

-- RLS: sin policies. anon/authenticated no leen ni escriben; service-role sí.
alter table public.link_responses enable row level security;
revoke all on public.link_responses from anon, authenticated;
grant select, insert, update on public.link_responses to service_role;

-- COMPAT LEGACY (R14.13): `0004` declaró el INSERT público en link_approvals
-- (policy `approvals_public_insert`) pero confió en los grants automáticos de
-- Supabase, que este proyecto NO aplica. Sin este grant, la aprobación legacy
-- falla con 42501. La policy sigue siendo la que valida link abierto/vigente.
grant insert on public.link_approvals to anon, authenticated, service_role;

comment on table public.link_responses is
  'Posición 14: decisión y observación del cliente por link (una fila, una vez).';
comment on column public.link_responses.decision is
  'approved | rejected. Inmutable (R14.1).';
comment on column public.link_responses.observation is
  'Texto 1..280 code points; sola o motivo del rechazo (R14.4/R14.14).';
comment on column public.link_responses.decision_channel is
  'Canal del aviso de rechazo (email | whatsapp). Null en aprobación.';
comment on column public.link_responses.observation_channel is
  'Canal del envío de la observación (email | whatsapp).';

-- ============================================================================
-- RPC 1 — DECISIÓN (aprobado/rechazado) + motivo opcional/reutilizado
-- ----------------------------------------------------------------------------
-- `select ... for update` sobre links serializa todas las respuestas del mismo
-- link. El legacy se consulta ANTES de escribir: una aprobación vieja cuenta
-- como decisión y bloquea una nueva (R14.13).
-- ============================================================================

create or replace function public.link_register_decision(
  p_link_id text,
  p_decision text,
  p_variant_id text,
  p_observation text default null,
  p_channel text default null,
  p_user_agent text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_link public.links%rowtype;
  v_response public.link_responses%rowtype;
  v_has_response boolean := false;
  v_observation text;
  v_legacy_variant text;
  v_legacy_at timestamptz;
  v_user_agent text := left(nullif(btrim(coalesce(p_user_agent, '')), ''), 200);
begin
  if p_decision is null or p_decision not in ('approved', 'rejected') then
    return jsonb_build_object('ok', false, 'code', 'INVALID_DECISION');
  end if;
  if p_variant_id is null or p_variant_id not in ('A', 'B', 'C') then
    return jsonb_build_object('ok', false, 'code', 'INVALID_VARIANT');
  end if;
  if p_channel is not null and p_channel not in ('email', 'whatsapp') then
    return jsonb_build_object('ok', false, 'code', 'INVALID_CHANNEL');
  end if;
  -- La aprobación no lleva observación ni canal: la observación es otra ruta
  -- (R14.4) y el aviso de aprobación sigue siendo WhatsApp/código (R6).
  if p_decision = 'approved' and p_observation is not null then
    return jsonb_build_object('ok', false, 'code', 'OBSERVATION_NOT_ALLOWED');
  end if;
  if p_decision = 'approved' and p_channel is not null then
    return jsonb_build_object('ok', false, 'code', 'INVALID_CHANNEL');
  end if;

  if p_observation is not null then
    v_observation := nullif(
      btrim(
        regexp_replace(
          regexp_replace(p_observation, E'\r\n?', E'\n', 'g'),
          E'\n{3,}', E'\n\n', 'g'
        )
      ),
      ''
    );
    if v_observation is null or char_length(v_observation) > 280 then
      return jsonb_build_object('ok', false, 'code', 'INVALID_OBSERVATION');
    end if;
  end if;

  select * into v_link
  from public.links
  where link_id = p_link_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'code', 'LINK_NOT_FOUND');
  end if;
  if v_link.expires_at <= now() then
    return jsonb_build_object('ok', false, 'code', 'LINK_EXPIRED');
  end if;

  if coalesce(jsonb_typeof(v_link.payload -> 'variants'), 'null') <> 'array' then
    return jsonb_build_object('ok', false, 'code', 'INVALID_VARIANT');
  end if;
  if not exists (
    select 1
    from jsonb_array_elements(v_link.payload -> 'variants') as variant
    where variant ->> 'id' = p_variant_id
  ) then
    return jsonb_build_object('ok', false, 'code', 'INVALID_VARIANT');
  end if;

  select * into v_response
  from public.link_responses
  where link_id = p_link_id;

  v_has_response := found;

  -- Legacy (R14.13): la última aprobación vieja es una decisión aprobada.
  if (not v_has_response or v_response.decision is null) then
    select variant_id, approved_at
    into v_legacy_variant, v_legacy_at
    from public.link_approvals
    where link_id = p_link_id
    order by approved_at desc
    limit 1;

    if found then
      return jsonb_build_object(
        'ok', false,
        'code', 'DECISION_TAKEN',
        'legacy', true,
        'decision', 'approved',
        'decision_variant_id', v_legacy_variant,
        'decided_at', v_legacy_at,
        'response', case when v_has_response then to_jsonb(v_response) else null end
      );
    end if;
  end if;

  if v_has_response and v_response.decision is not null then
    if v_response.decision = p_decision and v_response.decision_variant_id = p_variant_id then
      -- R14.4/R14.7: un motivo DISTINTO no es un reintento idempotente.
      if p_decision = 'rejected'
         and p_observation is not null
         and v_response.observation is not null
         and v_observation <> v_response.observation then
        return jsonb_build_object(
          'ok', false,
          'code', 'OBSERVATION_TAKEN',
          'response', to_jsonb(v_response)
        );
      end if;
      if p_decision = 'approved' or p_channel = v_response.decision_channel then
        return jsonb_build_object('ok', true, 'already', true, 'response', to_jsonb(v_response));
      end if;

      -- Fallback honesto del aviso de rechazo: el email no salió.
      if v_response.decision_channel = 'email'
         and v_response.decision_email_sent_at is null
         and p_channel = 'whatsapp' then
        update public.link_responses
        set decision_channel = 'whatsapp',
            decision_email_error = null
        where link_id = p_link_id
        returning * into v_response;

        return jsonb_build_object(
          'ok', true,
          'already', true,
          'fallback', true,
          'response', to_jsonb(v_response)
        );
      end if;
    end if;

    return jsonb_build_object(
      'ok', false,
      'code', 'DECISION_TAKEN',
      'response', to_jsonb(v_response)
    );
  end if;

  if p_decision = 'rejected' then
    -- Rechazo reutilizando una observación ya enviada (R14.3/R14.4).
    if v_has_response and v_response.observation is not null then
      if v_observation is not null and v_observation <> v_response.observation then
        return jsonb_build_object(
          'ok', false,
          'code', 'OBSERVATION_TAKEN',
          'response', to_jsonb(v_response)
        );
      end if;
      if p_channel is null then
        return jsonb_build_object('ok', false, 'code', 'INVALID_CHANNEL');
      end if;

      update public.link_responses
      set decision = 'rejected',
          decision_variant_id = p_variant_id,
          decided_at = now(),
          decision_channel = p_channel,
          decision_user_agent = v_user_agent
      where link_id = p_link_id
      returning * into v_response;

      return jsonb_build_object('ok', true, 'already', false, 'response', to_jsonb(v_response));
    end if;

    if v_observation is null then
      return jsonb_build_object('ok', false, 'code', 'OBSERVATION_REQUIRED');
    end if;
    if p_channel is null then
      return jsonb_build_object('ok', false, 'code', 'INVALID_CHANNEL');
    end if;

    insert into public.link_responses (
      link_id, decision, decision_variant_id, decided_at, decision_channel, decision_user_agent,
      observation, observed_at, observation_channel, observation_user_agent
    ) values (
      p_link_id, 'rejected', p_variant_id, now(), p_channel, v_user_agent,
      v_observation, now(), p_channel, v_user_agent
    )
    returning * into v_response;

    return jsonb_build_object('ok', true, 'already', false, 'response', to_jsonb(v_response));
  end if;

  -- Aprobación: la observación va por la ruta aparte (R14.4); el chequeo
  -- temprano de arriba ya rechazó cualquier p_observation.
  if v_has_response then
    update public.link_responses
    set decision = 'approved',
        decision_variant_id = p_variant_id,
        decided_at = now(),
        decision_channel = null,
        decision_user_agent = v_user_agent
    where link_id = p_link_id
    returning * into v_response;
  else
    insert into public.link_responses (
      link_id, decision, decision_variant_id, decided_at, decision_user_agent
    ) values (
      p_link_id, 'approved', p_variant_id, now(), v_user_agent
    )
    returning * into v_response;
  end if;

  -- Doble escritura legacy: el badge histórico y los consumidores viejos siguen.
  insert into public.link_approvals (link_id, variant_id, approved_at, user_agent)
  values (p_link_id, p_variant_id, v_response.decided_at, v_user_agent);

  return jsonb_build_object('ok', true, 'already', false, 'response', to_jsonb(v_response));
end;
$$;

revoke all on function public.link_register_decision(text, text, text, text, text, text) from public;
grant execute on function public.link_register_decision(text, text, text, text, text, text) to service_role;

-- ============================================================================
-- RPC 2 — OBSERVACIÓN SOLA (antes o después de aprobar)
-- ----------------------------------------------------------------------------
-- No toca la decisión. Si ya hay observación, solo acepta el mismo texto con
-- el mismo canal (idempotente) o el fallback email→WhatsApp cuando el email
-- no salió. Cualquier otro intento es OBSERVATION_TAKEN (R14.4).
-- ============================================================================

create or replace function public.link_register_observation(
  p_link_id text,
  p_message text,
  p_channel text,
  p_user_agent text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_link public.links%rowtype;
  v_response public.link_responses%rowtype;
  v_has_response boolean := false;
  v_message text;
  v_user_agent text := left(nullif(btrim(coalesce(p_user_agent, '')), ''), 200);
begin
  if p_channel is null or p_channel not in ('email', 'whatsapp') then
    return jsonb_build_object('ok', false, 'code', 'INVALID_CHANNEL');
  end if;

  v_message := nullif(
    btrim(
      regexp_replace(
        regexp_replace(coalesce(p_message, ''), E'\r\n?', E'\n', 'g'),
        E'\n{3,}', E'\n\n', 'g'
      )
    ),
    ''
  );
  if v_message is null or char_length(v_message) > 280 then
    return jsonb_build_object('ok', false, 'code', 'INVALID_OBSERVATION');
  end if;

  select * into v_link
  from public.links
  where link_id = p_link_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'code', 'LINK_NOT_FOUND');
  end if;
  if v_link.expires_at <= now() then
    return jsonb_build_object('ok', false, 'code', 'LINK_EXPIRED');
  end if;

  select * into v_response
  from public.link_responses
  where link_id = p_link_id;

  v_has_response := found;

  if v_has_response and v_response.observation is not null then
    if v_message = v_response.observation then
      if p_channel = v_response.observation_channel then
        return jsonb_build_object('ok', true, 'already', true, 'response', to_jsonb(v_response));
      end if;

      -- Fallback honesto: el email no salió, el cliente elige WhatsApp.
      if v_response.observation_channel = 'email'
         and v_response.observation_email_sent_at is null
         and p_channel = 'whatsapp' then
        update public.link_responses
        set observation_channel = 'whatsapp',
            observation_email_error = null
        where link_id = p_link_id
        returning * into v_response;

        return jsonb_build_object(
          'ok', true,
          'already', true,
          'fallback', true,
          'response', to_jsonb(v_response)
        );
      end if;
    end if;

    return jsonb_build_object(
      'ok', false,
      'code', 'OBSERVATION_TAKEN',
      'response', to_jsonb(v_response)
    );
  end if;

  if v_has_response then
    update public.link_responses
    set observation = v_message,
        observed_at = now(),
        observation_channel = p_channel,
        observation_user_agent = v_user_agent
    where link_id = p_link_id
    returning * into v_response;
  else
    insert into public.link_responses (
      link_id, observation, observed_at, observation_channel, observation_user_agent
    ) values (
      p_link_id, v_message, now(), p_channel, v_user_agent
    )
    returning * into v_response;
  end if;

  return jsonb_build_object('ok', true, 'already', false, 'response', to_jsonb(v_response));
end;
$$;

revoke all on function public.link_register_observation(text, text, text, text) from public;
grant execute on function public.link_register_observation(text, text, text, text) to service_role;

-- ============================================================================
-- Verificación (copiable en el SQL Editor):
--
--   -- tabla y constraints
--   select conname from pg_constraint
--    where conrelid = 'public.link_responses'::regclass
--    order by conname;
--
--   -- RPCs + permisos (solo service_role)
--   select proname, prosecdef
--     from pg_proc
--    where pronamespace = 'public'::regnamespace
--      and proname in ('link_register_decision', 'link_register_observation');
--
--   select has_function_privilege('service_role',
--     'public.link_register_decision(text,text,text,text,text,text)', 'execute') as service_ok,
--          has_function_privilege('anon',
--     'public.link_register_decision(text,text,text,text,text,text)', 'execute') as anon_no;
--   -- esperado: service_ok=true, anon_no=false
--
--   -- anon no puede leer la tabla (debe fallar con permission denied)
--   -- set role anon; select * from public.link_responses limit 1; reset role;
-- ============================================================================
