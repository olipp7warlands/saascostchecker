-- Bloque 3.4 — Catálogo interno (detección de solapamiento al solicitar)
--
-- Alcance real de docs/SPECS.md §3.4 / docs/TASKS.md §3.4: al elegir una
-- herramienta del catálogo en el formulario de solicitud, avisar si la org
-- YA la tiene contratada (vendor+contrato activos con el mismo catalog_id),
-- reutilizando la detección exacta por catalog_id que 3.3 ya construyó para
-- la conversión (record_purchase_request_conversion / /requests/[id]/convert)
-- — no una segunda heurística. El aviso informa, no bloquea: el solicitante
-- puede seguir adelante (p.ej. necesita asientos en otra empresa del grupo).
--
-- Decisiones confirmadas con el usuario antes de escribir esto:
-- 1) check_catalog_overlap() devuelve DOS niveles según el rol del CALLER
--    (la función ya sabe quién llama, vía auth.uid()): cualquier empleado
--    ve que existe/no existe, vendor, departamento/empresa, owner y nº de
--    contratos activos, SIN importes; MANAGER_ROLES (finance/it_admin/
--    org_admin) ven además el coste/moneda/ciclo de cada contrato. Esto es
--    una excepción deliberada a que vendors/contracts estén limitados a
--    MANAGER_ROLES (1.2) — ver justificación completa en docs/DECISIONS.md,
--    su alcance exacto es: solo el catalog_id concreto que se está
--    solicitando, nunca el resto del catálogo de vendors de la org.
-- 2) La función valida que p_catalog_id existe y busca ESTRICTAMENTE en la
--    org del caller (resuelta de su fila en `users`, nunca un parámetro) —
--    no es enumerable contra otra org.
-- 3) `known_overlap` en purchase_requests lo calcula el propio servidor
--    dentro de create_purchase_request() (misma query, vía el helper
--    has_active_catalog_overlap()) — nunca un valor que el cliente pueda
--    afirmar. Sirve para que el aprobador vea en el detalle que el
--    solicitante fue avisado y decidió continuar de todos modos.
-- 4) El "ahorro potencial" se etiqueta como estimación en la UI (no una
--    cifra contable) — ver mensajes en Requests.overlap.*.

-- =========================================================================
-- 1. purchase_requests.known_overlap
-- =========================================================================

alter table public.purchase_requests
  add column known_overlap boolean not null default false;

-- =========================================================================
-- 2. has_active_catalog_overlap() — helper interno compartido
-- =========================================================================
-- Toma p_org_id como parámetro (no lo resuelve de auth.uid()) porque lo usan
-- funciones que YA tienen al caller resuelto (create_purchase_request) —
-- por eso mismo NO puede quedar ejecutable directamente por ningún rol de
-- cliente (sería un canal para enumerar solapamientos de OTRAS orgs pasando
-- cualquier org_id). Revocado de public/anon/authenticated más abajo;
-- invocable solo desde dentro de otra función (se ejecuta como el dueño,
-- sin necesidad de grant explícito).
create function public.has_active_catalog_overlap(p_org_id uuid, p_catalog_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.contracts c
    join public.vendors v on v.id = c.vendor_id
    where v.org_id = p_org_id
      and v.catalog_id = p_catalog_id
      and v.status = 'active'
      and c.status = 'active'
  );
$$;

revoke execute on function public.has_active_catalog_overlap(uuid, uuid) from public;
revoke execute on function public.has_active_catalog_overlap(uuid, uuid) from anon;
revoke execute on function public.has_active_catalog_overlap(uuid, uuid) from authenticated;

-- =========================================================================
-- 3. check_catalog_overlap() — RPC de cliente, dos niveles según rol
-- =========================================================================
-- A diferencia de has_active_catalog_overlap(), esta SÍ resuelve org/rol del
-- caller internamente (auth.uid()) — no toma org_id como parámetro, así que
-- es segura de dejar ejecutable a cualquier autenticado (igual que
-- create_purchase_request, sin chequeo de rol: cualquier empleado puede
-- solicitar y por tanto necesita poder llamar a esto).
create function public.check_catalog_overlap(p_catalog_id uuid)
returns table (
  has_overlap boolean,
  active_contract_count integer,
  contracts jsonb
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_caller public.users%rowtype;
  v_is_manager boolean;
  v_contracts jsonb;
  v_count integer;
begin
  select * into v_caller from public.users where auth_id = auth.uid();

  if v_caller.id is null then
    raise exception 'not authenticated';
  end if;

  if not exists (select 1 from public.saas_catalog where id = p_catalog_id) then
    raise exception 'catalog_id not found';
  end if;

  v_is_manager := v_caller.role in ('finance', 'it_admin', 'org_admin');

  select count(*), coalesce(jsonb_agg(row_data), '[]'::jsonb)
  into v_count, v_contracts
  from (
    select jsonb_build_object(
      'vendor_id', v.id,
      'vendor_name', v.name,
      'vendor_website', v.website,
      'owner_name', ou.full_name,
      'department_name', d.name,
      'company_name', co.name,
      'cost_amount', case when v_is_manager then c.cost_amount else null end,
      'currency', case when v_is_manager then c.currency else null end,
      'billing_cycle', case when v_is_manager then c.billing_cycle else null end
    ) as row_data
    from public.contracts c
    join public.vendors v on v.id = c.vendor_id
    left join public.users ou on ou.id = v.owner_user_id
    left join public.departments d on d.id = c.department_id
    left join public.companies co on co.id = c.company_id
    -- org del CALLER (resuelta arriba), nunca un parámetro del cliente.
    where v.org_id = v_caller.org_id
      and v.catalog_id = p_catalog_id
      and v.status = 'active'
      and c.status = 'active'
  ) matches;

  return query select (v_count > 0), v_count, v_contracts;
end;
$$;

-- =========================================================================
-- 4. create_purchase_request() — calcula known_overlap server-side
--    (resto de la función sin cambios respecto a 0028)
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
  v_known_overlap boolean := false;
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

  if p_catalog_id is not null then
    v_known_overlap := public.has_active_catalog_overlap(v_caller.org_id, p_catalog_id);
  end if;

  select * into v_org from public.organizations where id = v_caller.org_id;
  v_amount := public.convert_amount(p_estimated_annual_cost, p_currency, v_org.default_currency);

  insert into public.purchase_requests (
    org_id, requester_id, catalog_id, vendor_name, estimated_annual_cost,
    currency, department_id, justification, alternatives_considered, status, known_overlap
  )
  values (
    v_caller.org_id, v_caller.id, p_catalog_id, p_vendor_name, p_estimated_annual_cost,
    p_currency, v_department_id, p_justification, p_alternatives_considered, 'pending', v_known_overlap
  )
  returning id into v_request_id;

  insert into public.audit_log (org_id, actor_id, action, entity, entity_id, diff)
  values (
    v_caller.org_id, v_caller.id, 'purchase_request.created', 'purchase_request', v_request_id,
    jsonb_build_object(
      'vendor_name', p_vendor_name, 'catalog_id', p_catalog_id,
      'estimated_annual_cost', p_estimated_annual_cost, 'currency', p_currency,
      'department_id', v_department_id, 'known_overlap', v_known_overlap
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
-- 5. notify_step_active() — añade known_overlap al payload de notificación
--    (resto de la función sin cambios respecto a 0028)
-- =========================================================================

create or replace function public.notify_step_active(
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
        'currency', v_request.currency, 'requester_name', v_requester_name, 'approval_token', v_token,
        'known_overlap', v_request.known_overlap
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
        'currency', v_request.currency, 'requester_name', v_requester_name, 'approval_token', v_token,
        'known_overlap', v_request.known_overlap
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
