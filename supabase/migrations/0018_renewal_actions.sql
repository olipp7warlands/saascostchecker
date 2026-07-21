-- Bloque 2.3b — Acciones sobre renovaciones (snooze, renegociado/cancelado, ahorro)
-- Diseño completo discutido y confirmado con el usuario, ver docs/DECISIONS.md.
--
-- 1. contracts.snoozed_until — columna nueva, sin tocar el check constraint de
--    status (renegociado es un EVENTO, no un status; snooze es ortogonal al
--    ciclo de vida del contrato, no lo saca de "active").
-- 2. savings_records — tabla nueva, ledger de eventos de ahorro (renegociación
--    o cancelación), agregable por vendor/departamento/empresa/periodo.
-- 3. update_contract() — bug encontrado y corregido: el índice único de
--    idempotencia de notifications (contract_id, user_id, threshold_days) no
--    tiene fecha, así que cambiar renewal_date sin limpiar notifications
--    bloquea para siempre la regeneración de esos umbrales en la fecha nueva.
--    También se bloquea p_status='cancelled' aquí — toda cancelación pasa por
--    cancel_contract() para garantizar que el ahorro siempre se captura.
-- 4. evaluate_renewal_alerts() — respeta snoozed_until en sus 2 CTEs.
-- 5. RPCs nuevos: set_contract_snooze(), renegotiate_contract(), cancel_contract()
--    — mismo idioma security definer + audit_log que el resto del repo.

-- =========================================================================
-- 1. contracts.snoozed_until
-- =========================================================================

alter table public.contracts add column snoozed_until date;

-- =========================================================================
-- 2. TABLA: savings_records
-- =========================================================================

create table public.savings_records (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  -- on delete set null (no cascade): el historial de ahorro es dato
  -- financiero, no debe desaparecer si el contrato/vendor se borra después
  -- (delete_contract/delete_vendor ya existen) — mismo criterio que audit_log,
  -- que tampoco se cascada. vendor_name queda como snapshot legible aunque
  -- ambas FKs terminen en null.
  contract_id uuid references public.contracts (id) on delete set null,
  vendor_id uuid references public.vendors (id) on delete set null,
  vendor_name text not null,
  kind text not null check (kind in ('renegotiated', 'cancelled')),
  previous_annual_cost numeric(14, 2) not null,
  new_annual_cost numeric(14, 2) not null,
  -- Moneda default de la org en el momento de capturar — el ahorro se guarda
  -- ya convertido (previous/new/savings), no se reconvierte al leer, para que
  -- un cambio futuro de moneda default de la org no reinterprete cifras
  -- históricas con tasas de cambio de otro momento.
  currency char(3) not null,
  savings_amount numeric(14, 2) not null,
  -- Fecha de "cierre" — usada para agregar "ahorro conseguido este año".
  closed_at date not null,
  notes text,
  created_by uuid references public.users (id) on delete set null,
  created_at timestamptz not null default now()
);

create index savings_records_org_closed_at_idx on public.savings_records (org_id, closed_at);
create index savings_records_vendor_id_idx on public.savings_records (vendor_id);

alter table public.savings_records enable row level security;

-- Mismos roles que contracts_select — dato financiero de gestión, no visible
-- a employee/manager.
create policy savings_records_select on public.savings_records
  for select
  using (
    org_id = public.current_org_id()
    and public.current_user_role() in ('finance', 'it_admin', 'org_admin')
  );

create policy savings_records_no_insert on public.savings_records
  for insert
  with check (false);

create policy savings_records_no_update on public.savings_records
  for update
  using (false);

create policy savings_records_no_delete on public.savings_records
  for delete
  using (false);

-- =========================================================================
-- 3. update_contract() — misma firma (create or replace), dos añadidos
-- =========================================================================

create or replace function public.update_contract(
  p_contract_id uuid,
  p_name text,
  p_cost_amount numeric,
  p_currency char(3),
  p_billing_cycle text,
  p_seats_purchased integer,
  p_start_date date,
  p_renewal_date date,
  p_auto_renews boolean,
  p_cancellation_notice_days integer,
  p_document_url text,
  p_status text,
  p_department_id uuid default null,
  p_company_id uuid default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller public.users%rowtype;
  v_contract public.contracts%rowtype;
begin
  select * into v_caller from public.users where auth_id = auth.uid();

  if v_caller.role not in ('finance', 'it_admin', 'org_admin') then
    raise exception 'insufficient privileges to update contracts';
  end if;

  select * into v_contract from public.contracts where id = p_contract_id and org_id = v_caller.org_id;

  if not found then
    raise exception 'contract not found';
  end if;

  -- Toda cancelación debe capturar ahorro — el único camino es
  -- cancel_contract(), que además limpia notifications obsoletas en la misma
  -- transacción que el cambio de status.
  if p_status = 'cancelled' and v_contract.status <> 'cancelled' then
    raise exception 'use cancel_contract() to cancel a contract, not update_contract()';
  end if;

  if p_department_id is not null
     and not exists (
       select 1 from public.departments
       where id = p_department_id and org_id = v_caller.org_id
     ) then
    raise exception 'department_id does not belong to this organization';
  end if;

  if p_company_id is not null
     and not exists (
       select 1 from public.companies
       where id = p_company_id and org_id = v_caller.org_id
     ) then
    raise exception 'company_id does not belong to this organization';
  end if;

  -- Bug encontrado en el diseño de 2.3b: el índice único de idempotencia de
  -- notifications es (contract_id, user_id, threshold_days), SIN fecha. Si
  -- renewal_date cambia y no se limpian las filas viejas, ese índice bloquea
  -- para siempre la regeneración de esos mismos umbrales en la fecha nueva,
  -- aunque la amerite — ya era un bug latente en ediciones manuales de fecha
  -- antes de este bloque, no solo en el flujo nuevo de renegociar.
  if p_renewal_date is distinct from v_contract.renewal_date then
    delete from public.notifications
    where contract_id = p_contract_id and type = 'renewal_alert';
  end if;

  update public.contracts
  set name = p_name, cost_amount = p_cost_amount, currency = p_currency,
      billing_cycle = p_billing_cycle, seats_purchased = p_seats_purchased,
      start_date = p_start_date, renewal_date = p_renewal_date, auto_renews = p_auto_renews,
      cancellation_notice_days = p_cancellation_notice_days, document_url = p_document_url,
      status = p_status, department_id = p_department_id, company_id = p_company_id,
      updated_at = now()
  where id = p_contract_id;

  insert into public.audit_log (org_id, actor_id, action, entity, entity_id, diff)
  values (
    v_caller.org_id, v_caller.id, 'contract.updated', 'contract', p_contract_id,
    jsonb_build_object(
      'old', jsonb_build_object(
        'name', v_contract.name, 'cost_amount', v_contract.cost_amount, 'currency', v_contract.currency,
        'billing_cycle', v_contract.billing_cycle, 'renewal_date', v_contract.renewal_date,
        'document_url', v_contract.document_url, 'status', v_contract.status,
        'department_id', v_contract.department_id, 'company_id', v_contract.company_id
      ),
      'new', jsonb_build_object(
        'name', p_name, 'cost_amount', p_cost_amount, 'currency', p_currency,
        'billing_cycle', p_billing_cycle, 'renewal_date', p_renewal_date,
        'document_url', p_document_url, 'status', p_status,
        'department_id', p_department_id, 'company_id', p_company_id
      )
    )
  );
end;
$$;

-- =========================================================================
-- 4. evaluate_renewal_alerts() — misma firma (create or replace), respeta snooze
-- =========================================================================

create or replace function public.evaluate_renewal_alerts(p_today date default current_date)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_inserted integer := 0;
  v_batch integer;
begin
  with due_contracts as (
    select
      c.id as contract_id,
      c.org_id,
      v.owner_user_id,
      v.name as vendor_name,
      c.name as contract_name,
      c.renewal_date,
      (c.renewal_date - p_today) as days_until
    from public.contracts c
    join public.vendors v on v.id = c.vendor_id
    where c.status = 'active'
      and (c.renewal_date - p_today) in (90, 60, 30, 7)
      and (c.snoozed_until is null or c.snoozed_until < p_today)
  ),
  recipients as (
    select distinct
      dc.contract_id, dc.org_id, dc.vendor_name, dc.contract_name, dc.renewal_date, dc.days_until,
      u.id as user_id
    from due_contracts dc
    join public.users u
      on u.org_id = dc.org_id
      and (u.id = dc.owner_user_id or u.role = 'finance')
  ),
  inserted as (
    insert into public.notifications (org_id, user_id, type, contract_id, threshold_days, payload)
    select
      r.org_id, r.user_id, 'renewal_alert', r.contract_id, r.days_until,
      jsonb_build_object(
        'vendor_name', r.vendor_name,
        'contract_name', r.contract_name,
        'renewal_date', r.renewal_date,
        'days_until', r.days_until
      )
    from recipients r
    on conflict (contract_id, user_id, threshold_days) where type = 'renewal_alert' do nothing
    returning 1
  )
  select count(*) into v_batch from inserted;
  v_inserted := v_inserted + v_batch;

  with due_notice as (
    select
      c.id as contract_id,
      c.org_id,
      v.owner_user_id,
      v.name as vendor_name,
      c.name as contract_name,
      c.renewal_date,
      c.cancellation_notice_days
    from public.contracts c
    join public.vendors v on v.id = c.vendor_id
    where c.status = 'active'
      and c.auto_renews
      and c.cancellation_notice_days > 0
      and (c.renewal_date - c.cancellation_notice_days) = p_today
      and (c.snoozed_until is null or c.snoozed_until < p_today)
  ),
  recipients2 as (
    select distinct
      dn.contract_id, dn.org_id, dn.vendor_name, dn.contract_name, dn.renewal_date, dn.cancellation_notice_days,
      u.id as user_id
    from due_notice dn
    join public.users u
      on u.org_id = dn.org_id
      and (u.id = dn.owner_user_id or u.role = 'finance')
  ),
  inserted2 as (
    insert into public.notifications (org_id, user_id, type, contract_id, threshold_days, payload)
    select
      r.org_id, r.user_id, 'renewal_alert', r.contract_id, -1,
      jsonb_build_object(
        'vendor_name', r.vendor_name,
        'contract_name', r.contract_name,
        'renewal_date', r.renewal_date,
        'notice_days', r.cancellation_notice_days,
        'notice_expired', true
      )
    from recipients2 r
    on conflict (contract_id, user_id, threshold_days) where type = 'renewal_alert' do nothing
    returning 1
  )
  select count(*) into v_batch from inserted2;
  v_inserted := v_inserted + v_batch;

  return v_inserted;
end;
$$;

-- =========================================================================
-- 5. RPCs nuevos
-- =========================================================================

create function public.set_contract_snooze(
  p_contract_id uuid,
  p_snoozed_until date
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller public.users%rowtype;
  v_contract public.contracts%rowtype;
begin
  select * into v_caller from public.users where auth_id = auth.uid();

  if v_caller.role not in ('finance', 'it_admin', 'org_admin') then
    raise exception 'insufficient privileges to snooze contracts';
  end if;

  select * into v_contract from public.contracts where id = p_contract_id and org_id = v_caller.org_id;

  if not found then
    raise exception 'contract not found';
  end if;

  if v_contract.status <> 'active' then
    raise exception 'only active contracts can be snoozed';
  end if;

  update public.contracts
  set snoozed_until = p_snoozed_until, updated_at = now()
  where id = p_contract_id;

  insert into public.audit_log (org_id, actor_id, action, entity, entity_id, diff)
  values (
    v_caller.org_id, v_caller.id,
    case when p_snoozed_until is null then 'contract.unsnoozed' else 'contract.snoozed' end,
    'contract', p_contract_id,
    jsonb_build_object('old_snoozed_until', v_contract.snoozed_until, 'new_snoozed_until', p_snoozed_until)
  );
end;
$$;

-- previous_annual_cost/new_annual_cost/savings_amount llegan ya calculados
-- desde TypeScript (annualizedCost()+convertAmount(), ya testeados) — el RPC
-- persiste, no recalcula conversión de divisa en PL/pgSQL. savings_amount es
-- explícitamente editable por el usuario en el diálogo, no un límite de
-- seguridad que cruzar.
create function public.renegotiate_contract(
  p_contract_id uuid,
  p_new_cost_amount numeric,
  p_new_currency char(3),
  p_new_billing_cycle text,
  p_new_renewal_date date,
  p_previous_annual_cost numeric,
  p_new_annual_cost numeric,
  p_savings_amount numeric,
  p_org_currency char(3),
  p_closed_at date,
  p_notes text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller public.users%rowtype;
  v_contract public.contracts%rowtype;
  v_vendor public.vendors%rowtype;
  v_savings_id uuid;
begin
  select * into v_caller from public.users where auth_id = auth.uid();

  if v_caller.role not in ('finance', 'it_admin', 'org_admin') then
    raise exception 'insufficient privileges to renegotiate contracts';
  end if;

  select * into v_contract from public.contracts where id = p_contract_id and org_id = v_caller.org_id;

  if not found then
    raise exception 'contract not found';
  end if;

  if v_contract.status <> 'active' then
    raise exception 'only active contracts can be renegotiated';
  end if;

  select * into v_vendor from public.vendors where id = v_contract.vendor_id;

  update public.contracts
  set cost_amount = p_new_cost_amount,
      currency = p_new_currency,
      billing_cycle = p_new_billing_cycle,
      renewal_date = p_new_renewal_date,
      snoozed_until = null,
      updated_at = now()
  where id = p_contract_id;

  -- Mismo fix que update_contract(): la fecha de renovación cambió, limpiar
  -- notifications obsoletas para no bloquear la regeneración futura de
  -- umbrales vía el índice único (contract_id, user_id, threshold_days).
  delete from public.notifications
  where contract_id = p_contract_id and type = 'renewal_alert';

  insert into public.savings_records (
    org_id, contract_id, vendor_id, vendor_name, kind,
    previous_annual_cost, new_annual_cost, currency, savings_amount, closed_at, notes, created_by
  )
  values (
    v_caller.org_id, p_contract_id, v_contract.vendor_id, v_vendor.name, 'renegotiated',
    p_previous_annual_cost, p_new_annual_cost, p_org_currency, p_savings_amount, p_closed_at, p_notes, v_caller.id
  )
  returning id into v_savings_id;

  insert into public.audit_log (org_id, actor_id, action, entity, entity_id, diff)
  values (
    v_caller.org_id, v_caller.id, 'contract.renegotiated', 'contract', p_contract_id,
    jsonb_build_object(
      'old', jsonb_build_object(
        'cost_amount', v_contract.cost_amount, 'currency', v_contract.currency,
        'billing_cycle', v_contract.billing_cycle, 'renewal_date', v_contract.renewal_date
      ),
      'new', jsonb_build_object(
        'cost_amount', p_new_cost_amount, 'currency', p_new_currency,
        'billing_cycle', p_new_billing_cycle, 'renewal_date', p_new_renewal_date
      ),
      'savings_amount', p_savings_amount, 'savings_record_id', v_savings_id
    )
  );

  return v_savings_id;
end;
$$;

create function public.cancel_contract(
  p_contract_id uuid,
  p_previous_annual_cost numeric,
  p_new_annual_cost numeric,
  p_savings_amount numeric,
  p_org_currency char(3),
  p_closed_at date,
  p_notes text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller public.users%rowtype;
  v_contract public.contracts%rowtype;
  v_vendor public.vendors%rowtype;
  v_savings_id uuid;
begin
  select * into v_caller from public.users where auth_id = auth.uid();

  if v_caller.role not in ('finance', 'it_admin', 'org_admin') then
    raise exception 'insufficient privileges to cancel contracts';
  end if;

  select * into v_contract from public.contracts where id = p_contract_id and org_id = v_caller.org_id;

  if not found then
    raise exception 'contract not found';
  end if;

  if v_contract.status <> 'active' then
    raise exception 'only active contracts can be cancelled';
  end if;

  select * into v_vendor from public.vendors where id = v_contract.vendor_id;

  update public.contracts
  set status = 'cancelled', snoozed_until = null, updated_at = now()
  where id = p_contract_id;

  -- El contrato ya no está active: evaluate_renewal_alerts() lo excluye de
  -- futuras generaciones sin ningún cambio adicional. Lo que queda por
  -- limpiar son las notificaciones ya generadas y aún no enviadas — ya no hay
  -- nada que alertar.
  delete from public.notifications
  where contract_id = p_contract_id and type = 'renewal_alert';

  insert into public.savings_records (
    org_id, contract_id, vendor_id, vendor_name, kind,
    previous_annual_cost, new_annual_cost, currency, savings_amount, closed_at, notes, created_by
  )
  values (
    v_caller.org_id, p_contract_id, v_contract.vendor_id, v_vendor.name, 'cancelled',
    p_previous_annual_cost, p_new_annual_cost, p_org_currency, p_savings_amount, p_closed_at, p_notes, v_caller.id
  )
  returning id into v_savings_id;

  insert into public.audit_log (org_id, actor_id, action, entity, entity_id, diff)
  values (
    v_caller.org_id, v_caller.id, 'contract.cancelled', 'contract', p_contract_id,
    jsonb_build_object('savings_amount', p_savings_amount, 'savings_record_id', v_savings_id)
  );

  return v_savings_id;
end;
$$;
