-- Bloque 3.2b — Delegaciones de aprobación
--
-- Construye sobre el motor de 3.2a (0023-0027). Diseño aprobado con el
-- usuario en modo planificación (ver docs/DECISIONS.md):
--
--   - Solo se delega un APROBADOR CONCRETO (resolved_approver_id), nunca un
--     rol entero — delegar un rol completo sería un poder desproporcionado
--     para un mecanismo pensado como "me voy de vacaciones".
--   - Resolución DINÁMICA, nunca congelada en el snapshot: purchase_request_steps
--     no cambia por delegación (sigue describiendo cómo se resolvió el
--     aprobador ORIGINAL). En cada punto donde se decide "a quién notificar
--     / quién puede resolver" se resuelve el aprobador efectivo en caliente
--     contra approval_delegations vigentes en ESE instante — si configuras
--     una delegación después de que el paso ya esté activo, se aplica igual.
--   - ADITIVO, no exclusivo: durante la ventana, tanto el original como el
--     delegado pueden resolver.
--   - SIN CADENAS: la resolución mira un solo salto desde el
--     resolved_approver_id original (resolve_effective_approver() nunca
--     sigue una delegación creada a partir del delegado).
--   - Auto-aprobación bloqueada también vía delegado: si quien finalmente
--     decide (ya autorizado) es el propio solicitante, se rechaza.
--   - Notificación a UN SOLO destinatario (el efectivo), nunca a ambos. Si
--     el efectivo coincide con el solicitante de esa solicitud concreta, no
--     se le notifica a él (no podría actuar) — cae al aprobador original.
--   - Actor real + delegante, nunca suplantación silenciosa:
--     approval_actions gana `delegated_from_id`. Para el link firmado (sin
--     sesión) el token debe saber de antemano para quién se minó —
--     approval_link_tokens gana `token_actor_id`/`token_delegated_from_id`.
--
-- Refactor interno (toca código de 3.2a en producción, con justificación):
-- las 4 llamadas casi idénticas a "resolver destinatario + minar token +
-- notificar" (create_purchase_request, advance_purchase_request_step, y las
-- 2 pasadas de evaluate_approval_reminders_and_escalations) se extraen a
-- notify_step_active(), que ahora resuelve delegación una sola vez.

-- =========================================================================
-- 1. TABLA: approval_delegations
-- =========================================================================

create table public.approval_delegations (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  delegator_user_id uuid not null references public.users (id) on delete cascade,
  delegate_user_id uuid not null references public.users (id) on delete cascade,
  starts_on date not null,
  ends_on date not null,
  created_by uuid not null references public.users (id) on delete cascade,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  check (delegate_user_id <> delegator_user_id),
  check (ends_on >= starts_on)
);

create index approval_delegations_delegator_idx
  on public.approval_delegations (delegator_user_id, starts_on, ends_on)
  where revoked_at is null;

create index approval_delegations_delegate_idx on public.approval_delegations (delegate_user_id);

alter table public.approval_delegations enable row level security;

create policy approval_delegations_select on public.approval_delegations
  for select
  using (
    org_id = public.current_org_id()
    and (
      delegator_user_id = public.current_user_id()
      or delegate_user_id = public.current_user_id()
      or public.current_user_role() = 'org_admin'
    )
  );

create policy approval_delegations_no_insert on public.approval_delegations for insert with check (false);
create policy approval_delegations_no_update on public.approval_delegations for update using (false);
create policy approval_delegations_no_delete on public.approval_delegations for delete using (false);

-- =========================================================================
-- 2. HELPERS de delegación
-- =========================================================================

-- Llamado DIRECTAMENTE desde políticas RLS (purchase_request_steps_select,
-- approval_actions_select) — nunca se revoca de authenticated/anon (igual
-- que current_org_id()/is_purchase_request_step_approver()): siempre
-- relativo al CALLER (current_user_id()), así que no filtra nada sobre
-- delegaciones ajenas — solo "¿soy yo delegado activo de X?".
create function public.is_active_delegate_of(p_delegator_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.approval_delegations d
    where d.delegator_user_id = p_delegator_user_id
      and d.delegate_user_id = public.current_user_id()
      and d.revoked_at is null
      and d.starts_on <= current_date and d.ends_on >= current_date
  );
$$;

-- Resuelve "quién actúa hoy por p_user_id": el delegado vigente si hay uno,
-- si no el propio p_user_id. Un solo salto (nunca sigue una delegación del
-- delegado). Toma un p_user_id ARBITRARIO (no implícitamente el caller), así
-- que sí revela relaciones de delegación de terceros — nunca se expone
-- directamente a un RPC de cliente, solo se invoca desde otras funciones
-- SECURITY DEFINER de este archivo (mismo régimen que mint_approval_link_token).
create function public.resolve_effective_approver(p_user_id uuid, p_today date default current_date)
returns table (actor_id uuid, delegated_from_id uuid)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_delegate uuid;
begin
  select delegate_user_id into v_delegate
  from public.approval_delegations
  where delegator_user_id = p_user_id
    and revoked_at is null
    and starts_on <= p_today and ends_on >= p_today
  order by created_at desc
  limit 1;

  if v_delegate is not null then
    return query select v_delegate, p_user_id;
  else
    return query select p_user_id, null::uuid;
  end if;
end;
$$;

revoke execute on function public.resolve_effective_approver(uuid, date) from public;
revoke execute on function public.resolve_effective_approver(uuid, date) from anon;
revoke execute on function public.resolve_effective_approver(uuid, date) from authenticated;

-- =========================================================================
-- 3. RPCs de gestión de delegaciones
-- =========================================================================

-- Autoservicio (el propio delegante) u org_admin (cobertura cuando alguien
-- se va sin avisar). Rechaza solape de fechas con otra delegación vigente
-- del MISMO delegante — evita ambigüedad de "¿cuál aplica?" sin necesitar
-- una regla de desempate.
create function public.create_approval_delegation(
  p_delegator_user_id uuid,
  p_delegate_user_id uuid,
  p_starts_on date,
  p_ends_on date
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller public.users%rowtype;
  v_delegation_id uuid;
begin
  select * into v_caller from public.users where auth_id = auth.uid();

  if v_caller.id is null then
    raise exception 'not authenticated';
  end if;

  if v_caller.id <> p_delegator_user_id and v_caller.role <> 'org_admin' then
    raise exception 'only the delegator or org_admin can create this delegation';
  end if;

  if not exists (select 1 from public.users where id = p_delegator_user_id and org_id = v_caller.org_id) then
    raise exception 'delegator_user_id does not belong to this organization';
  end if;

  if not exists (select 1 from public.users where id = p_delegate_user_id and org_id = v_caller.org_id) then
    raise exception 'delegate_user_id does not belong to this organization';
  end if;

  if p_delegate_user_id = p_delegator_user_id then
    raise exception 'cannot delegate to yourself';
  end if;

  if p_ends_on < p_starts_on then
    raise exception 'ends_on must not be before starts_on';
  end if;

  if exists (
    select 1 from public.approval_delegations
    where delegator_user_id = p_delegator_user_id
      and revoked_at is null
      and p_starts_on <= ends_on and p_ends_on >= starts_on
  ) then
    raise exception 'an active delegation already overlaps this date range for this delegator';
  end if;

  insert into public.approval_delegations (org_id, delegator_user_id, delegate_user_id, starts_on, ends_on, created_by)
  values (v_caller.org_id, p_delegator_user_id, p_delegate_user_id, p_starts_on, p_ends_on, v_caller.id)
  returning id into v_delegation_id;

  insert into public.audit_log (org_id, actor_id, action, entity, entity_id, diff)
  values (
    v_caller.org_id, v_caller.id, 'approval_delegation.created', 'approval_delegation', v_delegation_id,
    jsonb_build_object(
      'delegator_user_id', p_delegator_user_id, 'delegate_user_id', p_delegate_user_id,
      'starts_on', p_starts_on, 'ends_on', p_ends_on
    )
  );

  return v_delegation_id;
end;
$$;

create function public.revoke_approval_delegation(p_delegation_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller public.users%rowtype;
  v_delegation public.approval_delegations%rowtype;
begin
  select * into v_caller from public.users where auth_id = auth.uid();

  if v_caller.id is null then
    raise exception 'not authenticated';
  end if;

  select * into v_delegation
  from public.approval_delegations
  where id = p_delegation_id and org_id = v_caller.org_id;

  if v_delegation.id is null then
    raise exception 'delegation not found';
  end if;

  if v_delegation.revoked_at is not null then
    raise exception 'delegation already revoked';
  end if;

  if v_caller.id <> v_delegation.delegator_user_id
     and v_caller.id <> v_delegation.created_by
     and v_caller.role <> 'org_admin' then
    raise exception 'insufficient privileges to revoke this delegation';
  end if;

  update public.approval_delegations set revoked_at = now() where id = p_delegation_id;

  insert into public.audit_log (org_id, actor_id, action, entity, entity_id, diff)
  values (v_caller.org_id, v_caller.id, 'approval_delegation.revoked', 'approval_delegation', p_delegation_id, '{}'::jsonb);
end;
$$;

-- =========================================================================
-- 4. Ensanche de RLS: un delegado vigente debe poder VER la solicitud/paso
--    que va a resolver (no solo estar autorizado a resolver vía RPC) — mismo
--    bug de 3.2a (0026/0027) si se omite: sin esto, un delegado podría
--    aprobar por RPC pero /requests/[id] le daría 404.
-- =========================================================================

create or replace function public.is_purchase_request_step_approver(p_request_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.purchase_request_steps s
    where s.request_id = p_request_id
      and (
        s.resolved_approver_id = public.current_user_id()
        or (s.approver_role is not null and public.current_user_role() = s.approver_role)
        or (s.resolved_approver_id is not null and public.is_active_delegate_of(s.resolved_approver_id))
      )
  );
$$;

drop policy purchase_request_steps_select on public.purchase_request_steps;

create policy purchase_request_steps_select on public.purchase_request_steps
  for select
  using (
    org_id = public.current_org_id()
    and (
      resolved_approver_id = public.current_user_id()
      or (approver_role is not null and public.current_user_role() = approver_role)
      or public.current_user_role() = 'org_admin'
      or (resolved_approver_id is not null and public.is_active_delegate_of(resolved_approver_id))
      or exists (
        select 1 from public.purchase_requests pr
        where pr.id = purchase_request_steps.request_id
          and pr.requester_id = public.current_user_id()
      )
    )
  );

drop policy approval_actions_select on public.approval_actions;

create policy approval_actions_select on public.approval_actions
  for select
  using (
    org_id = public.current_org_id()
    and (
      public.current_user_role() = 'org_admin'
      or exists (
        select 1 from public.purchase_requests pr
        where pr.id = approval_actions.request_id and pr.requester_id = public.current_user_id()
      )
      or exists (
        select 1 from public.purchase_request_steps s
        where s.request_id = approval_actions.request_id
          and s.step_order = approval_actions.step_order
          and (
            s.resolved_approver_id = public.current_user_id()
            or (s.approver_role is not null and public.current_user_role() = s.approver_role)
            or (s.resolved_approver_id is not null and public.is_active_delegate_of(s.resolved_approver_id))
          )
      )
    )
  );

-- =========================================================================
-- 5. Columnas nuevas: atribución de "actor real + delegante"
-- =========================================================================

alter table public.approval_actions
  add column delegated_from_id uuid references public.users (id) on delete set null;

alter table public.approval_link_tokens
  add column token_actor_id uuid references public.users (id) on delete set null,
  add column token_delegated_from_id uuid references public.users (id) on delete set null;

-- =========================================================================
-- 6. mint_approval_link_token() — firma ampliada (drop+create: cambia el
--    número de parámetros, no basta con create or replace)
-- =========================================================================

drop function public.mint_approval_link_token(uuid, uuid, integer);

create function public.mint_approval_link_token(
  p_org_id uuid,
  p_request_id uuid,
  p_step_order integer,
  p_actor_id uuid default null,
  p_delegated_from_id uuid default null
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_secret text;
  v_secret_hash text;
  v_token_id uuid;
begin
  v_secret := encode(extensions.gen_random_bytes(32), 'hex');
  v_secret_hash := encode(extensions.digest(v_secret, 'sha256'), 'hex');

  insert into public.approval_link_tokens (
    org_id, request_id, step_order, secret_hash, expires_at, token_actor_id, token_delegated_from_id
  )
  values (
    p_org_id, p_request_id, p_step_order, v_secret_hash, now() + interval '72 hours', p_actor_id, p_delegated_from_id
  )
  returning id into v_token_id;

  return v_token_id::text || '_' || v_secret;
end;
$$;

revoke execute on function public.mint_approval_link_token(uuid, uuid, integer, uuid, uuid) from public;
revoke execute on function public.mint_approval_link_token(uuid, uuid, integer, uuid, uuid) from anon;
revoke execute on function public.mint_approval_link_token(uuid, uuid, integer, uuid, uuid) from authenticated;

-- =========================================================================
-- 7. notify_step_active() — nueva: única fuente de "resolver destinatario +
--    minar token + notificar", ahora consciente de delegación. Sustituye el
--    bloque casi-duplicado que vivía inline en create_purchase_request(),
--    advance_purchase_request_step(), y las 2 pasadas de
--    evaluate_approval_reminders_and_escalations().
-- =========================================================================

create function public.notify_step_active(
  p_request_id uuid,
  p_step_order integer,
  p_notification_type text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_request public.purchase_requests%rowtype;
  v_step public.purchase_request_steps%rowtype;
  v_requester_name text;
  v_effective_actor_id uuid;
  v_delegated_from_id uuid;
  v_token text;
begin
  select * into v_request from public.purchase_requests where id = p_request_id;
  select * into v_step from public.purchase_request_steps
    where request_id = p_request_id and step_order = p_step_order;

  select full_name into v_requester_name from public.users where id = v_request.requester_id;

  if v_step.resolved_approver_id is not null then
    select actor_id, delegated_from_id into v_effective_actor_id, v_delegated_from_id
    from public.resolve_effective_approver(v_step.resolved_approver_id);

    -- Edge case: si el efectivo (el delegado) coincide con el solicitante de
    -- ESTA solicitud, no se le notifica (no podría actuar — la guarda de
    -- resolve_purchase_request() lo rechazaría) — cae al aprobador original.
    if v_effective_actor_id = v_request.requester_id then
      v_effective_actor_id := v_step.resolved_approver_id;
      v_delegated_from_id := null;
    end if;

    v_token := public.mint_approval_link_token(
      v_request.org_id, p_request_id, p_step_order, v_effective_actor_id, v_delegated_from_id
    );

    insert into public.notifications (org_id, user_id, type, request_id, step_order, payload)
    values (
      v_request.org_id, v_effective_actor_id, p_notification_type, p_request_id, p_step_order,
      jsonb_build_object(
        'vendor_name', v_request.vendor_name, 'estimated_annual_cost', v_request.estimated_annual_cost,
        'currency', v_request.currency, 'requester_name', v_requester_name, 'approval_token', v_token
      )
    )
    on conflict (request_id, step_order, user_id, type)
      where type in ('purchase_request_step_pending', 'purchase_request_reminder', 'purchase_request_escalated')
      do nothing;
  else
    v_token := public.mint_approval_link_token(v_request.org_id, p_request_id, p_step_order, null, null);

    insert into public.notifications (org_id, user_id, type, request_id, step_order, payload)
    select
      v_request.org_id, u.id, p_notification_type, p_request_id, p_step_order,
      jsonb_build_object(
        'vendor_name', v_request.vendor_name, 'estimated_annual_cost', v_request.estimated_annual_cost,
        'currency', v_request.currency, 'requester_name', v_requester_name, 'approval_token', v_token
      )
    from public.users u
    where u.org_id = v_request.org_id and u.role = v_step.approver_role
    on conflict (request_id, step_order, user_id, type)
      where type in ('purchase_request_step_pending', 'purchase_request_reminder', 'purchase_request_escalated')
      do nothing;
  end if;
end;
$$;

revoke execute on function public.notify_step_active(uuid, integer, text) from public;
revoke execute on function public.notify_step_active(uuid, integer, text) from anon;
revoke execute on function public.notify_step_active(uuid, integer, text) from authenticated;

-- =========================================================================
-- 8. advance_purchase_request_step() — firma ampliada (drop+create) +
--    delegated_from_id + usa notify_step_active()
-- =========================================================================

drop function public.advance_purchase_request_step(uuid, integer, text, text, text, uuid);

create function public.advance_purchase_request_step(
  p_request_id uuid,
  p_step_order integer,
  p_decision text,
  p_comment text,
  p_acted_via text,
  p_actor_id uuid,
  p_delegated_from_id uuid default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_request public.purchase_requests%rowtype;
  v_step public.purchase_request_steps%rowtype;
  v_next public.purchase_request_steps%rowtype;
begin
  select * into v_request from public.purchase_requests where id = p_request_id for update;

  if v_request.id is null then
    raise exception 'purchase request not found';
  end if;

  select * into v_step
  from public.purchase_request_steps
  where request_id = p_request_id and step_order = p_step_order
    and status in ('pending', 'escalated_to_org_admin')
  for update;

  if v_step.id is null then
    raise exception 'approval step not found or not active';
  end if;

  if p_decision = 'rejected' then
    update public.purchase_request_steps
    set status = 'rejected', decided_by = p_actor_id, decided_at = now(), comment = p_comment
    where id = v_step.id;

    update public.purchase_requests
    set status = 'rejected', rejection_reason = p_comment, updated_at = now()
    where id = p_request_id;

    insert into public.approval_actions (org_id, request_id, step_order, action, actor_id, acted_via, comment, delegated_from_id)
    values (v_request.org_id, p_request_id, p_step_order, 'rejected', p_actor_id, p_acted_via, p_comment, p_delegated_from_id);

    insert into public.audit_log (org_id, actor_id, action, entity, entity_id, diff)
    values (
      v_request.org_id, p_actor_id, 'purchase_request.rejected', 'purchase_request', p_request_id,
      jsonb_build_object('decision', 'rejected', 'rejection_reason', p_comment, 'step_order', p_step_order)
    );

    perform public.revoke_approval_link_tokens(p_request_id);

    insert into public.notifications (org_id, user_id, type, request_id, payload)
    values (
      v_request.org_id, v_request.requester_id, 'purchase_request_resolved', p_request_id,
      jsonb_build_object('vendor_name', v_request.vendor_name, 'status', 'rejected', 'rejection_reason', p_comment)
    )
    on conflict (request_id, user_id, type) where type = 'purchase_request_resolved' do nothing;

    return;
  end if;

  update public.purchase_request_steps
  set status = 'approved', decided_by = p_actor_id, decided_at = now(), comment = p_comment
  where id = v_step.id;

  insert into public.approval_actions (org_id, request_id, step_order, action, actor_id, acted_via, comment, delegated_from_id)
  values (v_request.org_id, p_request_id, p_step_order, 'approved', p_actor_id, p_acted_via, p_comment, p_delegated_from_id);

  perform public.revoke_approval_link_tokens(p_request_id);

  select * into v_next
  from public.purchase_request_steps
  where request_id = p_request_id and status = 'queued'
  order by step_order
  limit 1;

  if v_next.id is null then
    update public.purchase_requests set status = 'approved', updated_at = now() where id = p_request_id;

    insert into public.audit_log (org_id, actor_id, action, entity, entity_id, diff)
    values (
      v_request.org_id, p_actor_id, 'purchase_request.approved', 'purchase_request', p_request_id,
      jsonb_build_object('step_order', p_step_order)
    );

    insert into public.notifications (org_id, user_id, type, request_id, payload)
    values (
      v_request.org_id, v_request.requester_id, 'purchase_request_resolved', p_request_id,
      jsonb_build_object('vendor_name', v_request.vendor_name, 'status', 'approved', 'rejection_reason', null)
    )
    on conflict (request_id, user_id, type) where type = 'purchase_request_resolved' do nothing;

    return;
  end if;

  update public.purchase_request_steps
  set status = 'pending', step_started_at = now()
  where id = v_next.id;

  update public.purchase_requests set current_step = v_next.step_order, updated_at = now() where id = p_request_id;

  perform public.notify_step_active(p_request_id, v_next.step_order, 'purchase_request_step_pending');
end;
$$;

revoke execute on function public.advance_purchase_request_step(uuid, integer, text, text, text, uuid, uuid) from public;
revoke execute on function public.advance_purchase_request_step(uuid, integer, text, text, text, uuid, uuid) from anon;
revoke execute on function public.advance_purchase_request_step(uuid, integer, text, text, text, uuid, uuid) from authenticated;

-- =========================================================================
-- 9. resolve_purchase_request() — autorización ampliada (aprobador original
--    O delegado vigente) + guarda genérica de auto-aprobación (también
--    cubre el caso nuevo: delegado = solicitante)
-- =========================================================================

create or replace function public.resolve_purchase_request(
  p_request_id uuid,
  p_decision text,
  p_rejection_reason text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller public.users%rowtype;
  v_step public.purchase_request_steps%rowtype;
  v_request public.purchase_requests%rowtype;
  v_effective_actor_id uuid;
  v_effective_delegated_from_id uuid;
  v_delegated_from_id uuid;
begin
  select * into v_caller from public.users where auth_id = auth.uid();

  if v_caller.id is null then
    raise exception 'not authenticated';
  end if;

  if p_decision not in ('approved', 'rejected') then
    raise exception 'p_decision must be approved or rejected';
  end if;

  select * into v_step
  from public.purchase_request_steps
  where request_id = p_request_id and org_id = v_caller.org_id
    and status in ('pending', 'escalated_to_org_admin')
  limit 1;

  if v_step.id is null then
    raise exception 'purchase request is not pending';
  end if;

  if v_step.resolved_approver_id is not null then
    select actor_id, delegated_from_id into v_effective_actor_id, v_effective_delegated_from_id
    from public.resolve_effective_approver(v_step.resolved_approver_id);
  end if;

  -- coalesce a false: si resolved_approver_id es null (paso por rol) la
  -- comparación de igualdad es null, no false — sin el coalesce, "not (null
  -- or false)" es null y el `if` no dispara, dejando pasar a un usuario no
  -- autorizado. Nunca confiar en la propagación de NULL para un guard.
  if not coalesce(
    v_step.resolved_approver_id = v_caller.id
    or (v_effective_actor_id is not null and v_effective_actor_id = v_caller.id)
    or (v_step.approver_role is not null and v_caller.role = v_step.approver_role),
    false
  ) then
    raise exception 'insufficient privileges to resolve purchase requests';
  end if;

  select * into v_request from public.purchase_requests where id = p_request_id;

  -- Auto-aprobación bloqueada por CUALQUIER camino de autorización (aprobador
  -- original, delegado, o rol) — el tope de 3.2a ya evita que el ORIGINAL
  -- coincida con el solicitante al materializar; este es el caso nuevo que
  -- introduce la delegación (el delegado sí podría coincidir).
  if v_caller.id = v_request.requester_id then
    raise exception 'the requester cannot resolve their own request';
  end if;

  if p_decision = 'rejected' and (p_rejection_reason is null or length(trim(p_rejection_reason)) = 0) then
    raise exception 'rejection_reason is required when rejecting';
  end if;

  v_delegated_from_id := case
    when v_step.resolved_approver_id = v_caller.id then null
    when v_effective_actor_id = v_caller.id then v_effective_delegated_from_id
    else null
  end;

  perform public.advance_purchase_request_step(
    p_request_id, v_step.step_order, p_decision, p_rejection_reason, 'ui', v_caller.id, v_delegated_from_id
  );
end;
$$;

-- =========================================================================
-- 10. resolve_purchase_request_via_link() — atribuye actor/delegante desde
--     las columnas del token en vez de asumir siempre al aprobador original
-- =========================================================================

create or replace function public.resolve_purchase_request_via_link(
  p_token_id uuid,
  p_secret text,
  p_decision text,
  p_comment text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_token public.approval_link_tokens%rowtype;
  v_step public.purchase_request_steps%rowtype;
begin
  if p_decision not in ('approved', 'rejected') then
    raise exception 'p_decision must be approved or rejected';
  end if;

  select * into v_token from public.approval_link_tokens where id = p_token_id for update;

  if v_token.id is null
     or v_token.used_at is not null
     or v_token.revoked_at is not null
     or v_token.expires_at <= now()
     or encode(extensions.digest(p_secret, 'sha256'), 'hex') <> v_token.secret_hash then
    raise exception 'invalid_or_expired_token';
  end if;

  select * into v_step
  from public.purchase_request_steps
  where request_id = v_token.request_id and step_order = v_token.step_order
    and status in ('pending', 'escalated_to_org_admin')
  for update;

  if v_step.id is null then
    raise exception 'invalid_or_expired_token';
  end if;

  if p_decision = 'rejected' and (p_comment is null or length(trim(p_comment)) = 0) then
    raise exception 'rejection_reason is required when rejecting';
  end if;

  update public.approval_link_tokens set used_at = now() where id = p_token_id;

  -- Atribución real: el token ya sabe para quién se minó (token_actor_id) y
  -- si era un delegado (token_delegated_from_id) — nunca se asume que quien
  -- clica es el aprobador original. Fallback a v_step.resolved_approver_id
  -- solo por si existiera un token minado antes de esta migración.
  perform public.advance_purchase_request_step(
    v_token.request_id, v_step.step_order, p_decision, p_comment, 'link',
    coalesce(v_token.token_actor_id, v_step.resolved_approver_id),
    v_token.token_delegated_from_id
  );
end;
$$;

-- =========================================================================
-- 11. create_purchase_request() — usa notify_step_active() en vez del
--     bloque de notificación inline (resto de la función sin cambios)
-- =========================================================================

create or replace function public.create_purchase_request(
  p_catalog_id uuid,
  p_vendor_name text,
  p_estimated_annual_cost numeric,
  p_currency char(3),
  p_department_id uuid,
  p_justification text,
  p_alternatives_considered text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller public.users%rowtype;
  v_department_id uuid;
  v_request_id uuid;
  v_org public.organizations%rowtype;
  v_amount numeric;
  v_manager_user_id uuid;
  v_use_department_rules boolean;
  v_is_auto_tier boolean;
  v_step_orders integer[];
  v_approver_types text[];
  v_approver_roles text[];
  v_resolved_approver_ids uuid[];
  v_resolved_vias text[];
  v_self_matches boolean[];
  v_step_count integer;
  v_all_self_match boolean;
  v_active_found boolean := false;
  v_active_step_order integer;
  v_reassigned_role text;
  v_i integer;
  v_is_last boolean;
begin
  select * into v_caller from public.users where auth_id = auth.uid();

  if v_caller.id is null then
    raise exception 'not authenticated';
  end if;

  v_department_id := p_department_id;

  if v_department_id is not null
     and not exists (
       select 1 from public.departments
       where id = v_department_id and org_id = v_caller.org_id
     ) then
    raise exception 'department_id does not belong to this organization';
  end if;

  if v_department_id is null then
    v_department_id := v_caller.department_id;
  end if;

  if p_catalog_id is not null and not exists (
    select 1 from public.saas_catalog where id = p_catalog_id
  ) then
    raise exception 'catalog_id not found';
  end if;

  select * into v_org from public.organizations where id = v_caller.org_id;
  v_amount := public.convert_amount(p_estimated_annual_cost, p_currency, v_org.default_currency);

  insert into public.purchase_requests (
    org_id, requester_id, catalog_id, vendor_name, estimated_annual_cost,
    currency, department_id, justification, alternatives_considered, status
  )
  values (
    v_caller.org_id, v_caller.id, p_catalog_id, p_vendor_name, p_estimated_annual_cost,
    p_currency, v_department_id, p_justification, p_alternatives_considered, 'pending'
  )
  returning id into v_request_id;

  insert into public.audit_log (org_id, actor_id, action, entity, entity_id, diff)
  values (
    v_caller.org_id, v_caller.id, 'purchase_request.created', 'purchase_request', v_request_id,
    jsonb_build_object(
      'vendor_name', p_vendor_name, 'catalog_id', p_catalog_id,
      'estimated_annual_cost', p_estimated_annual_cost, 'currency', p_currency,
      'department_id', v_department_id
    )
  );

  if v_department_id is not null then
    select manager_user_id into v_manager_user_id
    from public.departments where id = v_department_id;
  end if;

  select exists (
    select 1 from public.approval_rules
    where org_id = v_caller.org_id and department_id = v_department_id
      and v_amount >= min_amount and (max_amount is null or v_amount < max_amount)
  ) into v_use_department_rules;

  select exists (
    select 1 from public.approval_rules
    where org_id = v_caller.org_id
      and department_id is not distinct from (case when v_use_department_rules then v_department_id else null end)
      and v_amount >= min_amount and (max_amount is null or v_amount < max_amount)
      and approver_type = 'auto'
  ) into v_is_auto_tier;

  if v_is_auto_tier then
    update public.purchase_requests set status = 'approved', updated_at = now() where id = v_request_id;

    insert into public.approval_actions (org_id, request_id, step_order, action, actor_id, acted_via, comment)
    values (v_caller.org_id, v_request_id, 1, 'approved', null, 'system', null);

    insert into public.audit_log (org_id, actor_id, action, entity, entity_id, diff)
    values (v_caller.org_id, null, 'purchase_request.approved', 'purchase_request', v_request_id,
      jsonb_build_object('resolved_via', 'auto'));

    insert into public.notifications (org_id, user_id, type, request_id, payload)
    values (v_caller.org_id, v_caller.id, 'purchase_request_resolved', v_request_id,
      jsonb_build_object('vendor_name', p_vendor_name, 'status', 'approved', 'rejection_reason', null))
    on conflict (request_id, user_id, type) where type = 'purchase_request_resolved' do nothing;

    return v_request_id;
  end if;

  select
    array_agg(step_order order by step_order),
    array_agg(approver_type order by step_order),
    array_agg(resolved_role order by step_order),
    array_agg(resolved_approver_id order by step_order),
    array_agg(resolved_via order by step_order),
    array_agg(is_self_match order by step_order)
  into v_step_orders, v_approver_types, v_approver_roles, v_resolved_approver_ids, v_resolved_vias, v_self_matches
  from (
    select
      ar.step_order,
      ar.approver_type,
      case
        when ar.approver_type = 'role' then ar.approver_role
        when ar.approver_type = 'manager_of_requester' and v_manager_user_id is null then 'org_admin'
        else null
      end as resolved_role,
      case
        when ar.approver_type = 'manager_of_requester' then v_manager_user_id
        when ar.approver_type = 'specific_user' then ar.approver_user_id
        else null
      end as resolved_approver_id,
      case
        when ar.approver_type = 'manager_of_requester' and v_manager_user_id is null then 'fallback_no_manager'
        else 'rule'
      end as resolved_via,
      (
        coalesce(
          (case when ar.approver_type = 'manager_of_requester' then v_manager_user_id
                when ar.approver_type = 'specific_user' then ar.approver_user_id
                else null end) = v_caller.id,
          false
        )
        or coalesce(
          (case when ar.approver_type = 'role' then ar.approver_role
                when ar.approver_type = 'manager_of_requester' and v_manager_user_id is null then 'org_admin'
                else null end) = v_caller.role,
          false
        )
      ) as is_self_match
    from public.approval_rules ar
    where ar.org_id = v_caller.org_id
      and ar.department_id is not distinct from (case when v_use_department_rules then v_department_id else null end)
      and v_amount >= ar.min_amount and (ar.max_amount is null or v_amount < ar.max_amount)
      and ar.approver_type <> 'auto'
  ) resolved;

  v_step_count := coalesce(array_length(v_step_orders, 1), 0);

  if v_step_count = 0 then
    raise exception 'no approval rule matches this request amount';
  end if;

  v_all_self_match := true;
  for v_i in 1..v_step_count loop
    if not v_self_matches[v_i] then
      v_all_self_match := false;
    end if;
  end loop;

  for v_i in 1..v_step_count loop
    v_is_last := (v_i = v_step_count);

    if v_is_last and v_all_self_match then
      v_reassigned_role := case when v_caller.role = 'org_admin' then 'finance' else 'org_admin' end;

      insert into public.purchase_request_steps (
        org_id, request_id, step_order, approver_type, approver_role,
        resolved_approver_id, resolved_via, status, step_started_at
      )
      values (
        v_caller.org_id, v_request_id, v_step_orders[v_i], v_approver_types[v_i], v_reassigned_role,
        null, 'reassigned_self_approval', 'pending', now()
      );

      v_active_found := true;
      v_active_step_order := v_step_orders[v_i];

    elsif v_self_matches[v_i] then
      insert into public.purchase_request_steps (
        org_id, request_id, step_order, approver_type, approver_role,
        resolved_approver_id, resolved_via, status, decided_at
      )
      values (
        v_caller.org_id, v_request_id, v_step_orders[v_i], v_approver_types[v_i], v_approver_roles[v_i],
        v_resolved_approver_ids[v_i], v_resolved_vias[v_i], 'skipped', now()
      );

      insert into public.approval_actions (org_id, request_id, step_order, action, actor_id, acted_via, comment)
      values (v_caller.org_id, v_request_id, v_step_orders[v_i], 'skipped_self', null, 'system', null);

    elsif not v_active_found then
      insert into public.purchase_request_steps (
        org_id, request_id, step_order, approver_type, approver_role,
        resolved_approver_id, resolved_via, status, step_started_at
      )
      values (
        v_caller.org_id, v_request_id, v_step_orders[v_i], v_approver_types[v_i], v_approver_roles[v_i],
        v_resolved_approver_ids[v_i], v_resolved_vias[v_i], 'pending', now()
      );

      v_active_found := true;
      v_active_step_order := v_step_orders[v_i];

    else
      insert into public.purchase_request_steps (
        org_id, request_id, step_order, approver_type, approver_role,
        resolved_approver_id, resolved_via, status
      )
      values (
        v_caller.org_id, v_request_id, v_step_orders[v_i], v_approver_types[v_i], v_approver_roles[v_i],
        v_resolved_approver_ids[v_i], v_resolved_vias[v_i], 'queued'
      );
    end if;
  end loop;

  if not v_active_found then
    raise exception 'invariant violated: no active approval step materialized';
  end if;

  update public.purchase_requests set current_step = v_active_step_order, updated_at = now() where id = v_request_id;

  perform public.notify_step_active(v_request_id, v_active_step_order, 'purchase_request_step_pending');

  return v_request_id;
end;
$$;

-- =========================================================================
-- 12. evaluate_approval_reminders_and_escalations() — usa notify_step_active()
--     en las 2 pasadas en vez del bloque de mint+notify inline
-- =========================================================================

create or replace function public.evaluate_approval_reminders_and_escalations()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer := 0;
  v_step record;
begin
  for v_step in
    select s.*
    from public.purchase_request_steps s
    where s.status in ('pending', 'escalated_to_org_admin')
      and s.reminded_at is null
      and s.step_started_at <= now() - interval '72 hours'
  loop
    perform public.revoke_approval_link_tokens(v_step.request_id);
    perform public.notify_step_active(v_step.request_id, v_step.step_order, 'purchase_request_reminder');

    update public.purchase_request_steps set reminded_at = now() where id = v_step.id;
    v_count := v_count + 1;
  end loop;

  for v_step in
    select s.*
    from public.purchase_request_steps s
    where s.status in ('pending', 'escalated_to_org_admin')
      and s.escalated_at is null
      and s.step_started_at <= now() - interval '7 days'
  loop
    update public.purchase_request_steps
    set resolved_approver_id = null,
        approver_role = 'org_admin',
        resolved_via = 'escalated_timeout',
        status = 'escalated_to_org_admin',
        escalated_at = now()
    where id = v_step.id;

    insert into public.approval_actions (org_id, request_id, step_order, action, actor_id, acted_via, comment)
    values (v_step.org_id, v_step.request_id, v_step.step_order, 'escalated', null, 'system', null);

    insert into public.audit_log (org_id, actor_id, action, entity, entity_id, diff)
    values (v_step.org_id, null, 'purchase_request.escalated', 'purchase_request', v_step.request_id,
      jsonb_build_object('step_order', v_step.step_order));

    perform public.revoke_approval_link_tokens(v_step.request_id);
    perform public.notify_step_active(v_step.request_id, v_step.step_order, 'purchase_request_escalated');

    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

revoke execute on function public.evaluate_approval_reminders_and_escalations() from public;
revoke execute on function public.evaluate_approval_reminders_and_escalations() from anon;
revoke execute on function public.evaluate_approval_reminders_and_escalations() from authenticated;
grant execute on function public.evaluate_approval_reminders_and_escalations() to service_role;
