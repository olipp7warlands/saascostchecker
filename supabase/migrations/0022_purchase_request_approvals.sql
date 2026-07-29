-- Bloque 3.1b — Ciclo de aprobación de Solicitudes (single-level)
--
-- Diseño confirmado con el usuario en modo planificación antes de escribir
-- esta migración (ver docs/DECISIONS.md): un único nivel de aprobación,
-- finance + org_admin resuelven cualquier solicitud pendiente de su org (sin
-- matriz por departamento/monto ni pasos multi-nivel — eso sigue siendo el
-- bloque 3.2, motor completo de SPECS §6, que puede construirse sobre estas
-- mismas RPCs/estados más adelante).
--
-- Contenido:
--   1. purchase_requests: nuevo estado 'cancelled', columna rejection_reason,
--      RLS de lectura ampliada a finance/org_admin (org-wide).
--   2. RPCs: resolve_purchase_request() (approve/reject), cancel_purchase_request()
--      (solo el solicitante, solo en pending), mark_purchase_request_purchased()
--      (solicitante o finance/org_admin, solo desde approved — botón manual,
--      sin automatismo de conversión a vendor/contrato, eso es 3.3).
--   3. create_purchase_request() reemplazada (mismo cuerpo + notificación a
--      los aprobadores).
--   4. notifications: columna request_id (mismo patrón que contract_id),
--      type ampliado con 'purchase_request_submitted'/'purchase_request_resolved',
--      nuevo índice único parcial de idempotencia (no reutiliza el de
--      renewal_alert, que está scoped a contract_id).

-- =========================================================================
-- 1. purchase_requests: estado 'cancelled' + rejection_reason + RLS ampliada
-- =========================================================================

alter table public.purchase_requests
  drop constraint purchase_requests_status_check;

alter table public.purchase_requests
  add constraint purchase_requests_status_check
  check (status in ('draft', 'pending', 'approved', 'rejected', 'purchased', 'cancelled'));

alter table public.purchase_requests
  add column rejection_reason text;

drop policy purchase_requests_select on public.purchase_requests;

create policy purchase_requests_select on public.purchase_requests
  for select
  using (
    org_id = public.current_org_id()
    and (
      requester_id = public.current_user_id()
      or public.current_user_role() in ('finance', 'org_admin')
    )
  );

-- =========================================================================
-- 2. notifications: request_id + tipos nuevos + índice de idempotencia
-- =========================================================================

alter table public.notifications
  add column request_id uuid references public.purchase_requests (id) on delete cascade;

alter table public.notifications
  drop constraint notifications_type_check;

alter table public.notifications
  add constraint notifications_type_check
  check (type in ('renewal_alert', 'purchase_request_submitted', 'purchase_request_resolved'));

-- Índice propio (no el de renewal_alert, que está scoped a contract_id):
-- una fila por (solicitud, destinatario, tipo) — cubre tanto "submitted"
-- (un aprobador puede recibir varias notificaciones de varias solicitudes,
-- pero solo una por solicitud) como "resolved" (una por solicitud, para el
-- solicitante).
create unique index notifications_purchase_request_unique_idx
  on public.notifications (request_id, user_id, type)
  where type in ('purchase_request_submitted', 'purchase_request_resolved');

-- =========================================================================
-- 3. create_purchase_request() — mismo cuerpo (0021) + notificación a
--    aprobadores (finance/org_admin de la org)
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

  insert into public.notifications (org_id, user_id, type, request_id, payload)
  select
    v_caller.org_id, u.id, 'purchase_request_submitted', v_request_id,
    jsonb_build_object(
      'vendor_name', p_vendor_name,
      'estimated_annual_cost', p_estimated_annual_cost,
      'currency', p_currency,
      'requester_name', v_caller.full_name
    )
  from public.users u
  where u.org_id = v_caller.org_id
    and u.role in ('finance', 'org_admin')
  on conflict (request_id, user_id, type) where type in ('purchase_request_submitted', 'purchase_request_resolved')
  do nothing;

  return v_request_id;
end;
$$;

-- =========================================================================
-- 4. RPC: resolve_purchase_request() — approve/reject, solo finance/org_admin
-- =========================================================================

create function public.resolve_purchase_request(
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
  v_request public.purchase_requests%rowtype;
begin
  select * into v_caller from public.users where auth_id = auth.uid();

  if v_caller.id is null then
    raise exception 'not authenticated';
  end if;

  if v_caller.role not in ('finance', 'org_admin') then
    raise exception 'insufficient privileges to resolve purchase requests';
  end if;

  if p_decision not in ('approved', 'rejected') then
    raise exception 'p_decision must be approved or rejected';
  end if;

  select * into v_request
  from public.purchase_requests
  where id = p_request_id and org_id = v_caller.org_id
  for update;

  if v_request.id is null then
    raise exception 'purchase request not found';
  end if;

  if v_request.status <> 'pending' then
    raise exception 'purchase request is not pending';
  end if;

  if p_decision = 'rejected' and (p_rejection_reason is null or length(trim(p_rejection_reason)) = 0) then
    raise exception 'rejection_reason is required when rejecting';
  end if;

  update public.purchase_requests
  set status = p_decision,
      rejection_reason = case when p_decision = 'rejected' then p_rejection_reason else null end,
      updated_at = now()
  where id = p_request_id;

  insert into public.audit_log (org_id, actor_id, action, entity, entity_id, diff)
  values (
    v_caller.org_id, v_caller.id,
    case when p_decision = 'approved' then 'purchase_request.approved' else 'purchase_request.rejected' end,
    'purchase_request', p_request_id,
    jsonb_build_object('decision', p_decision, 'rejection_reason', p_rejection_reason)
  );

  insert into public.notifications (org_id, user_id, type, request_id, payload)
  values (
    v_caller.org_id, v_request.requester_id, 'purchase_request_resolved', p_request_id,
    jsonb_build_object(
      'vendor_name', v_request.vendor_name,
      'status', p_decision,
      'rejection_reason', p_rejection_reason
    )
  )
  on conflict (request_id, user_id, type) where type in ('purchase_request_submitted', 'purchase_request_resolved')
  do nothing;
end;
$$;

-- =========================================================================
-- 5. RPC: cancel_purchase_request() — solo el propio solicitante, solo pending
-- =========================================================================

create function public.cancel_purchase_request(p_request_id uuid)
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
end;
$$;

-- =========================================================================
-- 6. RPC: mark_purchase_request_purchased() — botón manual, sin automatismo
--    de conversión a vendor/contrato (eso es el bloque 3.3)
-- =========================================================================

create function public.mark_purchase_request_purchased(p_request_id uuid)
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

  if v_request.requester_id <> v_caller.id and v_caller.role not in ('finance', 'org_admin') then
    raise exception 'insufficient privileges to mark this request as purchased';
  end if;

  if v_request.status <> 'approved' then
    raise exception 'purchase request is not approved';
  end if;

  update public.purchase_requests
  set status = 'purchased', updated_at = now()
  where id = p_request_id;

  insert into public.audit_log (org_id, actor_id, action, entity, entity_id, diff)
  values (v_caller.org_id, v_caller.id, 'purchase_request.purchased', 'purchase_request', p_request_id, '{}'::jsonb);
end;
$$;
