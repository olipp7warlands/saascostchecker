-- Bloque 3.2a — Motor de aprobaciones (núcleo end-to-end)
--
-- Construye sobre 3.1/3.1b (purchase_requests, resolve/cancel/mark_purchased)
-- el motor real de docs/SPECS.md §6: reglas por departamento/monto,
-- materialización inmutable de pasos, links firmados de un solo uso,
-- auto-skip con tope de seguridad, recordatorio 72h/escalado 7d.
--
-- Explícitamente FUERA de alcance (bloque 3.2b, no aquí): RPCs de
-- edición de approval_rules (esta migración solo siembra una matriz
-- default por org, sin UI/RPC para editarla) y approval_delegations.
--
-- Diseño aprobado con el usuario en modo planificación (ver
-- docs/DECISIONS.md) — 3 puntos no negociables de ese diseño:
--   1. Los links de aprobación son un atajo de AUTENTICACIÓN, nunca un
--      camino paralelo de autorización: resolve_purchase_request_via_link()
--      llama exactamente a la misma función interna que usa la UI
--      (advance_purchase_request_step), mismo audit_log, misma validación
--      de estado. Expiran a las 72h (no 7 días), se revocan si la
--      solicitud cambia de estado por cualquier otra vía, y devuelven el
--      mismo mensaje genérico ante token no encontrado/expirado/usado/
--      revocado (sin distinguir el motivo).
--   2. El recordatorio/escalado son idempotentes por dos capas: una
--      columna guarda (`reminded_at`/`escalated_at`, evita repetir la
--      mutación) + un índice único parcial en notifications (evita
--      duplicar el mensaje), igual que evaluate_renewal_alerts().
--   3. El snapshot de pasos (purchase_request_steps) se congela en el
--      momento de crear la solicitud copiando los valores de la regla —
--      nunca vuelve a leer approval_rules después. Cambios posteriores en
--      approval_rules (aunque hoy no haya RPC para hacerlos, solo SQL
--      directo) no afectan solicitudes ya materializadas.
--
-- Tope de seguridad al auto-skip (self-approval): si TODA la cadena de
-- pasos resueltos coincidiera con el propio solicitante (0 decisiones
-- humanas de alguien distinto), el ÚLTIMO paso NO se salta — se reasigna
-- a un rol distinto (org_admin solicitante → finance; cualquier otro rol
-- → org_admin) con resolved_via='reassigned_self_approval'. Si ese rol
-- tampoco tiene usuarios en la org, el paso queda 'pending' igualmente
-- (atascado y visible, no aprobado en silencio).

-- =========================================================================
-- 1. EXTENSIÓN + HELPER: convert_amount()
-- =========================================================================

-- gen_random_bytes()/digest() para los secretos de los links firmados —
-- primer uso de pgcrypto en el repo (gen_random_uuid() ya viene del core
-- de Postgres 13+, no necesitaba esta extensión).
create extension if not exists pgcrypto;

-- Puerto SQL literal de src/features/dashboard/currency.ts (convertAmount):
-- igual→sin cambio; rate directo en exchange_rates; si no, inverso; si no
-- hay ninguno, degrada devolviendo el monto sin convertir. Necesario aquí
-- porque la materialización de pasos ocurre atómicamente dentro de
-- create_purchase_request() (plpgsql), no se puede llamar a la versión TS.
create function public.convert_amount(p_amount numeric, p_from char(3), p_to char(3))
returns numeric
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_direct numeric;
  v_inverse numeric;
begin
  if p_from = p_to then
    return p_amount;
  end if;

  select rate into v_direct from public.exchange_rates
  where base_currency = p_from and quote_currency = p_to;

  if v_direct is not null then
    return p_amount * v_direct;
  end if;

  select rate into v_inverse from public.exchange_rates
  where base_currency = p_to and quote_currency = p_from;

  if v_inverse is not null then
    return p_amount / v_inverse;
  end if;

  return p_amount;
end;
$$;

-- =========================================================================
-- 2. TABLAS NUEVAS
-- =========================================================================

-- approval_rules: configuración por org (department_id null = regla
-- global). Sin RPC de edición todavía (eso es 3.2b) — hoy solo se puebla
-- por el seed de abajo (alta de org nueva + backfill de orgs existentes).
create table public.approval_rules (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  department_id uuid references public.departments (id) on delete cascade,
  min_amount numeric(14, 2) not null,
  max_amount numeric(14, 2),
  step_order integer not null check (step_order >= 1),
  approver_type text not null
    check (approver_type in ('auto', 'manager_of_requester', 'role', 'specific_user')),
  approver_role text
    check (approver_role is null or approver_role in ('employee', 'manager', 'finance', 'it_admin', 'org_admin')),
  approver_user_id uuid references public.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (max_amount is null or max_amount > min_amount),
  check (
    (approver_type = 'role' and approver_role is not null and approver_user_id is null)
    or (approver_type = 'specific_user' and approver_user_id is not null and approver_role is null)
    or (approver_type in ('auto', 'manager_of_requester') and approver_role is null and approver_user_id is null)
  )
);

create index approval_rules_org_department_idx on public.approval_rules (org_id, department_id);

alter table public.approval_rules enable row level security;

create policy approval_rules_select on public.approval_rules
  for select
  using (
    org_id = public.current_org_id()
    and public.current_user_role() in ('finance', 'it_admin', 'org_admin')
  );

create policy approval_rules_no_insert on public.approval_rules for insert with check (false);
create policy approval_rules_no_update on public.approval_rules for update using (false);
create policy approval_rules_no_delete on public.approval_rules for delete using (false);

-- purchase_request_steps: snapshot materializado e inmutable. `status`
-- distingue 'queued' (paso futuro, todavía no activado — step_started_at
-- null) de 'pending'/'escalated_to_org_admin' (el único paso activo a la
-- vez, garantizado por el índice único parcial de abajo) de los 3 estados
-- terminales de UN paso ('approved','rejected','skipped').
create table public.purchase_request_steps (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  request_id uuid not null references public.purchase_requests (id) on delete cascade,
  step_order integer not null,
  approver_type text not null
    check (approver_type in ('auto', 'manager_of_requester', 'role', 'specific_user')),
  approver_role text
    check (approver_role is null or approver_role in ('employee', 'manager', 'finance', 'it_admin', 'org_admin')),
  resolved_approver_id uuid references public.users (id) on delete set null,
  resolved_via text
    check (resolved_via is null or resolved_via in ('rule', 'fallback_no_manager', 'escalated_timeout', 'reassigned_self_approval')),
  status text not null default 'queued'
    check (status in ('queued', 'pending', 'approved', 'rejected', 'skipped', 'escalated_to_org_admin')),
  -- Nulo mientras el paso es 'queued'; se fija al activarse (creación si es
  -- el primero, o al avanzar desde el paso anterior).
  step_started_at timestamptz,
  reminded_at timestamptz,
  escalated_at timestamptz,
  decided_by uuid references public.users (id) on delete set null,
  decided_at timestamptz,
  comment text,
  created_at timestamptz not null default now(),
  unique (request_id, step_order)
);

create index purchase_request_steps_request_idx on public.purchase_request_steps (request_id, step_order);

-- Invariante de la que depende resolve_purchase_request()/advance_purchase_request_step():
-- solo puede haber un paso activo a la vez por solicitud.
create unique index purchase_request_steps_active_unique_idx
  on public.purchase_request_steps (request_id)
  where status in ('pending', 'escalated_to_org_admin');

alter table public.purchase_request_steps enable row level security;

create policy purchase_request_steps_select on public.purchase_request_steps
  for select
  using (
    org_id = public.current_org_id()
    and (
      resolved_approver_id = public.current_user_id()
      or (approver_role is not null and public.current_user_role() = approver_role)
      or public.current_user_role() = 'org_admin'
      or exists (
        select 1 from public.purchase_requests pr
        where pr.id = purchase_request_steps.request_id
          and pr.requester_id = public.current_user_id()
      )
    )
  );

create policy purchase_request_steps_no_insert on public.purchase_request_steps for insert with check (false);
create policy purchase_request_steps_no_update on public.purchase_request_steps for update using (false);
create policy purchase_request_steps_no_delete on public.purchase_request_steps for delete using (false);

-- approval_actions: log fino de movimientos (distinto de audit_log, que
-- sigue recibiendo su entrada resumen de siempre en cada RPC).
create table public.approval_actions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  request_id uuid not null references public.purchase_requests (id) on delete cascade,
  step_order integer not null,
  action text not null check (action in ('approved', 'rejected', 'skipped_self', 'escalated')),
  actor_id uuid references public.users (id) on delete set null,
  acted_via text not null check (acted_via in ('ui', 'link', 'system')),
  comment text,
  ip inet,
  created_at timestamptz not null default now()
);

create index approval_actions_request_idx on public.approval_actions (request_id, created_at);

alter table public.approval_actions enable row level security;

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
          )
      )
    )
  );

create policy approval_actions_no_insert on public.approval_actions for insert with check (false);
create policy approval_actions_no_update on public.approval_actions for update using (false);
create policy approval_actions_no_delete on public.approval_actions for delete using (false);

-- approval_link_tokens: secreto de un solo uso, sin acceso de cliente en
-- absoluto (igual que audit_log) — solo lo tocan las funciones SECURITY
-- DEFINER de abajo. Un solo token por evento de "paso activado", no uno
-- por destinatario: si el paso es por rol, el mismo link se envía a todos
-- los usuarios de ese rol; quien lo usa primero lo consume.
create table public.approval_link_tokens (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  request_id uuid not null references public.purchase_requests (id) on delete cascade,
  step_order integer not null,
  secret_hash text not null,
  expires_at timestamptz not null,
  used_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);

create index approval_link_tokens_request_idx on public.approval_link_tokens (request_id);

alter table public.approval_link_tokens enable row level security;

create policy approval_link_tokens_no_select on public.approval_link_tokens for select using (false);
create policy approval_link_tokens_no_insert on public.approval_link_tokens for insert with check (false);
create policy approval_link_tokens_no_update on public.approval_link_tokens for update using (false);
create policy approval_link_tokens_no_delete on public.approval_link_tokens for delete using (false);

-- =========================================================================
-- 3. notifications: step_order + tipos nuevos + índices de idempotencia
-- =========================================================================

alter table public.notifications add column step_order integer;

-- 'purchase_request_submitted' se conserva en la lista permitida solo para
-- no invalidar filas históricas de 3.1b (el código ya no la produce, la
-- sustituye 'purchase_request_step_pending' — ver docs/DECISIONS.md).
alter table public.notifications drop constraint notifications_type_check;
alter table public.notifications add constraint notifications_type_check
  check (type in (
    'renewal_alert',
    'purchase_request_submitted',
    'purchase_request_step_pending',
    'purchase_request_resolved',
    'purchase_request_reminder',
    'purchase_request_escalated'
  ));

drop index public.notifications_purchase_request_unique_idx;

-- Terminal (una vez por solicitud, sin step_order relevante).
create unique index notifications_purchase_request_terminal_unique_idx
  on public.notifications (request_id, user_id, type)
  where type = 'purchase_request_resolved';

-- Por paso (puede repetirse una vez por cada step_order de la misma
-- solicitud) — cubre step_pending/reminder/escalated.
create unique index notifications_purchase_request_step_unique_idx
  on public.notifications (request_id, step_order, user_id, type)
  where type in ('purchase_request_step_pending', 'purchase_request_reminder', 'purchase_request_escalated');

-- =========================================================================
-- 4. handle_new_user(): seed de matriz default para orgs nuevas + backfill
--    de orgs existentes que todavía no tienen ninguna approval_rules
-- =========================================================================

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org_id uuid;
  v_role text;
  v_invitation public.invitations%rowtype;
  v_token_hash text;
  v_user_id uuid;
  v_is_new_org boolean;
begin
  v_token_hash := new.raw_user_meta_data ->> 'invitation_token_hash';
  v_is_new_org := v_token_hash is null;

  if not v_is_new_org then
    select *
    into v_invitation
    from public.invitations
    where token_hash = v_token_hash
      and used_at is null
      and expires_at > now()
      and lower(email) = lower(new.email)
    for update;

    if not found then
      raise exception 'Invalid or expired invitation';
    end if;

    update public.invitations
    set used_at = now()
    where id = v_invitation.id;

    v_org_id := v_invitation.org_id;
    v_role := v_invitation.role;
  else
    insert into public.organizations (name, slug, default_currency, locale)
    values (
      new.raw_user_meta_data ->> 'org_name',
      new.raw_user_meta_data ->> 'org_slug',
      coalesce(new.raw_user_meta_data ->> 'default_currency', 'EUR'),
      coalesce(new.raw_user_meta_data ->> 'locale', 'es')
    )
    returning id into v_org_id;

    v_role := 'org_admin';

    -- Seed de matriz default (bloque 3.2a, SPECS §6): tiers globales
    -- (department_id null) en la moneda default de la org, literales sin
    -- escalar — igual que el ejemplo de SPECS §6. Primera vez que una org
    -- nueva recibe filas sembradas aparte de organizations/users.
    insert into public.approval_rules (org_id, department_id, min_amount, max_amount, step_order, approver_type, approver_role)
    values
      (v_org_id, null, 0, 500, 1, 'auto', null),
      (v_org_id, null, 500, 5000, 1, 'manager_of_requester', null),
      (v_org_id, null, 5000, null, 1, 'manager_of_requester', null),
      (v_org_id, null, 5000, null, 2, 'role', 'finance');
  end if;

  insert into public.users (auth_id, org_id, email, full_name, role)
  values (
    new.id,
    v_org_id,
    new.email,
    new.raw_user_meta_data ->> 'full_name',
    v_role
  )
  returning id into v_user_id;

  if not v_is_new_org then
    insert into public.audit_log (org_id, actor_id, action, entity, entity_id, diff)
    values (
      v_org_id, v_user_id, 'invitation.redeemed', 'invitation', v_invitation.id,
      jsonb_build_object('email', new.email, 'role', v_role)
    );
  else
    insert into public.audit_log (org_id, actor_id, action, entity, entity_id, diff)
    values (
      v_org_id, v_user_id, 'organization.created', 'organization', v_org_id,
      jsonb_build_object('name', new.raw_user_meta_data ->> 'org_name')
    );
  end if;

  return new;
end;
$$;

-- Backfill: orgs creadas antes de esta migración no tienen ninguna
-- approval_rules — sin esto, create_purchase_request() fallaría con "no
-- approval rule matches" para cualquier org de prueba existente.
insert into public.approval_rules (org_id, department_id, min_amount, max_amount, step_order, approver_type, approver_role)
select o.id, null, t.min_amount, t.max_amount, t.step_order, t.approver_type, t.approver_role
from public.organizations o
cross join (
  values
    (0::numeric, 500::numeric, 1, 'auto', null::text),
    (500::numeric, 5000::numeric, 1, 'manager_of_requester', null::text),
    (5000::numeric, null::numeric, 1, 'manager_of_requester', null::text),
    (5000::numeric, null::numeric, 2, 'role', 'finance')
) as t(min_amount, max_amount, step_order, approver_type, approver_role)
where not exists (select 1 from public.approval_rules ar where ar.org_id = o.id);

-- =========================================================================
-- 5. FUNCIONES DEL MOTOR (internas — revocadas de public/anon/authenticated;
--    solo se invocan desde otras funciones SECURITY DEFINER de este mismo
--    archivo, que ejecutan con el contexto del dueño y no se ven afectadas
--    por estos revokes, igual que evaluate_renewal_alerts())
-- =========================================================================

create function public.mint_approval_link_token(p_org_id uuid, p_request_id uuid, p_step_order integer)
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
  v_secret := encode(gen_random_bytes(32), 'hex');
  v_secret_hash := encode(digest(v_secret, 'sha256'), 'hex');

  insert into public.approval_link_tokens (org_id, request_id, step_order, secret_hash, expires_at)
  values (p_org_id, p_request_id, p_step_order, v_secret_hash, now() + interval '72 hours')
  returning id into v_token_id;

  return v_token_id::text || '_' || v_secret;
end;
$$;

revoke execute on function public.mint_approval_link_token(uuid, uuid, integer) from public;
revoke execute on function public.mint_approval_link_token(uuid, uuid, integer) from anon;
revoke execute on function public.mint_approval_link_token(uuid, uuid, integer) from authenticated;

create function public.revoke_approval_link_tokens(p_request_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.approval_link_tokens
  set revoked_at = now()
  where request_id = p_request_id and used_at is null and revoked_at is null;
$$;

revoke execute on function public.revoke_approval_link_tokens(uuid) from public;
revoke execute on function public.revoke_approval_link_tokens(uuid) from anon;
revoke execute on function public.revoke_approval_link_tokens(uuid) from authenticated;

-- Compartida por resolve_purchase_request() (UI) y
-- resolve_purchase_request_via_link() (link, sin sesión) — el único sitio
-- donde vive la lógica de "aprobar/rechazar el paso activo": nunca se
-- duplica entre los dos caminos de entrada.
create function public.advance_purchase_request_step(
  p_request_id uuid,
  p_step_order integer,
  p_decision text,
  p_comment text,
  p_acted_via text,
  p_actor_id uuid
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
  v_active_step public.purchase_request_steps%rowtype;
  v_token text;
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

    insert into public.approval_actions (org_id, request_id, step_order, action, actor_id, acted_via, comment)
    values (v_request.org_id, p_request_id, p_step_order, 'rejected', p_actor_id, p_acted_via, p_comment);

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

  insert into public.approval_actions (org_id, request_id, step_order, action, actor_id, acted_via, comment)
  values (v_request.org_id, p_request_id, p_step_order, 'approved', p_actor_id, p_acted_via, p_comment);

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

  v_token := public.mint_approval_link_token(v_request.org_id, p_request_id, v_next.step_order);

  select * into v_active_step from public.purchase_request_steps where id = v_next.id;

  if v_active_step.resolved_approver_id is not null then
    insert into public.notifications (org_id, user_id, type, request_id, step_order, payload)
    values (
      v_request.org_id, v_active_step.resolved_approver_id, 'purchase_request_step_pending', p_request_id, v_active_step.step_order,
      jsonb_build_object(
        'vendor_name', v_request.vendor_name, 'estimated_annual_cost', v_request.estimated_annual_cost,
        'currency', v_request.currency,
        'requester_name', (select full_name from public.users where id = v_request.requester_id),
        'approval_token', v_token
      )
    )
    on conflict (request_id, step_order, user_id, type)
      where type in ('purchase_request_step_pending', 'purchase_request_reminder', 'purchase_request_escalated')
      do nothing;
  else
    insert into public.notifications (org_id, user_id, type, request_id, step_order, payload)
    select
      v_request.org_id, u.id, 'purchase_request_step_pending', p_request_id, v_active_step.step_order,
      jsonb_build_object(
        'vendor_name', v_request.vendor_name, 'estimated_annual_cost', v_request.estimated_annual_cost,
        'currency', v_request.currency,
        'requester_name', (select full_name from public.users where id = v_request.requester_id),
        'approval_token', v_token
      )
    from public.users u
    where u.org_id = v_request.org_id and u.role = v_active_step.approver_role
    on conflict (request_id, step_order, user_id, type)
      where type in ('purchase_request_step_pending', 'purchase_request_reminder', 'purchase_request_escalated')
      do nothing;
  end if;
end;
$$;

revoke execute on function public.advance_purchase_request_step(uuid, integer, text, text, text, uuid) from public;
revoke execute on function public.advance_purchase_request_step(uuid, integer, text, text, text, uuid) from anon;
revoke execute on function public.advance_purchase_request_step(uuid, integer, text, text, text, uuid) from authenticated;

-- =========================================================================
-- 6. create_purchase_request() — reescrita: materializa el snapshot de
--    pasos (precedencia departamento > global, auto-skip con tope)
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
  v_active_step public.purchase_request_steps%rowtype;
  v_token text;
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

  -- ----------------------------------------------------------------------
  -- Motor de aprobaciones: precedencia total de departamento sobre global
  -- (si el departamento tiene su propia fila para este tramo, se usa esa
  -- entera; si no, cae a la global).
  -- ----------------------------------------------------------------------

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
      -- Tope al auto-skip: nunca se auto-aprueba sin una decisión humana
      -- distinta del solicitante.
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

  v_token := public.mint_approval_link_token(v_caller.org_id, v_request_id, v_active_step_order);

  select * into v_active_step
  from public.purchase_request_steps
  where request_id = v_request_id and step_order = v_active_step_order;

  if v_active_step.resolved_approver_id is not null then
    insert into public.notifications (org_id, user_id, type, request_id, step_order, payload)
    values (
      v_caller.org_id, v_active_step.resolved_approver_id, 'purchase_request_step_pending', v_request_id, v_active_step_order,
      jsonb_build_object(
        'vendor_name', p_vendor_name, 'estimated_annual_cost', p_estimated_annual_cost,
        'currency', p_currency, 'requester_name', v_caller.full_name, 'approval_token', v_token
      )
    )
    on conflict (request_id, step_order, user_id, type)
      where type in ('purchase_request_step_pending', 'purchase_request_reminder', 'purchase_request_escalated')
      do nothing;
  else
    insert into public.notifications (org_id, user_id, type, request_id, step_order, payload)
    select
      v_caller.org_id, u.id, 'purchase_request_step_pending', v_request_id, v_active_step_order,
      jsonb_build_object(
        'vendor_name', p_vendor_name, 'estimated_annual_cost', p_estimated_annual_cost,
        'currency', p_currency, 'requester_name', v_caller.full_name, 'approval_token', v_token
      )
    from public.users u
    where u.org_id = v_caller.org_id and u.role = v_active_step.approver_role
    on conflict (request_id, step_order, user_id, type)
      where type in ('purchase_request_step_pending', 'purchase_request_reminder', 'purchase_request_escalated')
      do nothing;
  end if;

  return v_request_id;
end;
$$;

-- =========================================================================
-- 7. resolve_purchase_request() — reescrita: opera sobre el paso activo
--    en vez de sobre purchase_requests.status directamente. Mismo
--    nombre/firma que 3.1b: cero cambios en actions.ts/UI de la acción.
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

  -- coalesce a false: si resolved_approver_id es null (paso por rol) la
  -- comparación de igualdad es null, no false — sin el coalesce, "not (null
  -- or false)" es null y el `if` no dispara, dejando pasar a un usuario no
  -- autorizado. Nunca confiar en la propagación de NULL para un guard.
  if not coalesce(
    v_step.resolved_approver_id = v_caller.id
    or (v_step.approver_role is not null and v_caller.role = v_step.approver_role),
    false
  ) then
    raise exception 'insufficient privileges to resolve purchase requests';
  end if;

  if p_decision = 'rejected' and (p_rejection_reason is null or length(trim(p_rejection_reason)) = 0) then
    raise exception 'rejection_reason is required when rejecting';
  end if;

  perform public.advance_purchase_request_step(
    p_request_id, v_step.step_order, p_decision, p_rejection_reason, 'ui', v_caller.id
  );
end;
$$;

-- =========================================================================
-- 8. resolve_purchase_request_via_link() — nueva: aprobar/rechazar desde
--    email/Teams sin login. El token autentica quién/qué; la decisión
--    pasa por advance_purchase_request_step(), igual que la UI. Mensaje
--    de error único para token no encontrado/expirado/usado/revocado —
--    nunca revela cuál de los casos es.
-- =========================================================================

create function public.resolve_purchase_request_via_link(
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
     or encode(digest(p_secret, 'sha256'), 'hex') <> v_token.secret_hash then
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

  -- Pasos por rol (approver_role, sin resolved_approver_id concreto) no
  -- tienen un usuario identificable de antemano: el actor auditado queda
  -- null (igual que las acciones automáticas del cron), acted_via='link'
  -- ya dice cómo se decidió.
  perform public.advance_purchase_request_step(
    v_token.request_id, v_step.step_order, p_decision, p_comment, 'link', v_step.resolved_approver_id
  );
end;
$$;

-- Sin auth.uid() — se invoca sin sesión, debe quedar accesible a anon
-- (grant PUBLIC por defecto, ningún revoke aquí).

-- =========================================================================
-- 9. cancel_purchase_request() — añade revocación de tokens vivos
-- =========================================================================

create or replace function public.cancel_purchase_request(p_request_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller public.users%rowtype;
  v_request public.purchase_requests%rowtype;
begin
  select * into v_caller from public.users where auth_id = auth.uid();

  if v_caller.id is null then
    raise exception 'not authenticated';
  end if;

  select * into v_request
  from public.purchase_requests
  where id = p_request_id and org_id = v_caller.org_id
  for update;

  if v_request.id is null then
    raise exception 'purchase request not found';
  end if;

  if v_request.requester_id <> v_caller.id then
    raise exception 'only the requester can cancel this request';
  end if;

  if v_request.status <> 'pending' then
    raise exception 'purchase request is not pending';
  end if;

  update public.purchase_requests
  set status = 'cancelled', updated_at = now()
  where id = p_request_id;

  insert into public.audit_log (org_id, actor_id, action, entity, entity_id, diff)
  values (v_caller.org_id, v_caller.id, 'purchase_request.cancelled', 'purchase_request', p_request_id, '{}'::jsonb);

  perform public.revoke_approval_link_tokens(p_request_id);
end;
$$;

-- =========================================================================
-- 10. Recordatorio 72h / escalado 7d + pg_cron diario
-- =========================================================================

create function public.evaluate_approval_reminders_and_escalations()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer := 0;
  v_step record;
  v_token text;
begin
  for v_step in
    select s.*, r.vendor_name, r.estimated_annual_cost, r.currency
    from public.purchase_request_steps s
    join public.purchase_requests r on r.id = s.request_id
    where s.status in ('pending', 'escalated_to_org_admin')
      and s.reminded_at is null
      and s.step_started_at <= now() - interval '72 hours'
  loop
    perform public.revoke_approval_link_tokens(v_step.request_id);
    v_token := public.mint_approval_link_token(v_step.org_id, v_step.request_id, v_step.step_order);

    if v_step.resolved_approver_id is not null then
      insert into public.notifications (org_id, user_id, type, request_id, step_order, payload)
      values (
        v_step.org_id, v_step.resolved_approver_id, 'purchase_request_reminder', v_step.request_id, v_step.step_order,
        jsonb_build_object(
          'vendor_name', v_step.vendor_name, 'estimated_annual_cost', v_step.estimated_annual_cost,
          'currency', v_step.currency, 'approval_token', v_token
        )
      )
      on conflict (request_id, step_order, user_id, type)
        where type in ('purchase_request_step_pending', 'purchase_request_reminder', 'purchase_request_escalated')
        do nothing;
    else
      insert into public.notifications (org_id, user_id, type, request_id, step_order, payload)
      select
        v_step.org_id, u.id, 'purchase_request_reminder', v_step.request_id, v_step.step_order,
        jsonb_build_object(
          'vendor_name', v_step.vendor_name, 'estimated_annual_cost', v_step.estimated_annual_cost,
          'currency', v_step.currency, 'approval_token', v_token
        )
      from public.users u
      where u.org_id = v_step.org_id and u.role = v_step.approver_role
      on conflict (request_id, step_order, user_id, type)
        where type in ('purchase_request_step_pending', 'purchase_request_reminder', 'purchase_request_escalated')
        do nothing;
    end if;

    update public.purchase_request_steps set reminded_at = now() where id = v_step.id;
    v_count := v_count + 1;
  end loop;

  for v_step in
    select s.*, r.vendor_name, r.estimated_annual_cost, r.currency
    from public.purchase_request_steps s
    join public.purchase_requests r on r.id = s.request_id
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
    v_token := public.mint_approval_link_token(v_step.org_id, v_step.request_id, v_step.step_order);

    insert into public.notifications (org_id, user_id, type, request_id, step_order, payload)
    select
      v_step.org_id, u.id, 'purchase_request_escalated', v_step.request_id, v_step.step_order,
      jsonb_build_object(
        'vendor_name', v_step.vendor_name, 'estimated_annual_cost', v_step.estimated_annual_cost,
        'currency', v_step.currency, 'approval_token', v_token
      )
    from public.users u
    where u.org_id = v_step.org_id and u.role = 'org_admin'
    on conflict (request_id, step_order, user_id, type)
      where type in ('purchase_request_step_pending', 'purchase_request_reminder', 'purchase_request_escalated')
      do nothing;

    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

revoke execute on function public.evaluate_approval_reminders_and_escalations() from public;
revoke execute on function public.evaluate_approval_reminders_and_escalations() from anon;
revoke execute on function public.evaluate_approval_reminders_and_escalations() from authenticated;
grant execute on function public.evaluate_approval_reminders_and_escalations() to service_role;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'approval-reminders-daily') then
    perform cron.unschedule('approval-reminders-daily');
  end if;
end;
$$;

-- 07:00 UTC — una hora después de renewal-alerts-daily (06:00), para no
-- competir por recursos en el mismo minuto.
select cron.schedule(
  'approval-reminders-daily',
  '0 7 * * *',
  $$select public.evaluate_approval_reminders_and_escalations()$$
);
