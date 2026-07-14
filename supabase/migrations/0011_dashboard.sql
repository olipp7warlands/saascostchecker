-- Bloque 1.5 — Dashboard
-- 1) contracts.department_id (atribución de gasto a departamento, ver
--    docs/DECISIONS.md bloque 1.5 para las alternativas rechazadas).
-- 2) exchange_rates (conversión de moneda a la moneda default de la org,
--    diferida explícitamente desde el bloque 1.2 — ver DECISIONS.md).
--
-- create_contract()/update_contract() se redefinen con `create or replace
-- function` en vez de editar 0005 in-place — 0005 ya está en remoto
-- (lección de proceso del bloque 1.3, ver DECISIONS.md).

-- =========================================================================
-- 1. contracts.department_id
-- =========================================================================

alter table public.contracts
  add column department_id uuid references public.departments (id) on delete set null;

create index contracts_department_id_idx on public.contracts (department_id);

-- `create or replace function` solo reemplaza una función si la lista de
-- parámetros es idéntica; al añadir p_department_id el nombre queda con dos
-- signaturas distintas (la de 0005 y esta), y PostgREST no puede resolver la
-- sobrecarga al llamar por nombre de parámetro (error PGRST203). Hay que
-- borrar la signatura vieja explícitamente antes de crear la nueva.
drop function public.create_contract(
  uuid, text, numeric, char(3), text, integer, date, date, boolean, integer, text
);
drop function public.update_contract(
  uuid, text, numeric, char(3), text, integer, date, date, boolean, integer, text, text
);

create function public.create_contract(
  p_vendor_id uuid,
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
  p_department_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller public.users%rowtype;
  v_contract_id uuid;
begin
  select * into v_caller from public.users where auth_id = auth.uid();

  if v_caller.role not in ('finance', 'it_admin', 'org_admin') then
    raise exception 'insufficient privileges to create contracts';
  end if;

  if not exists (
    select 1 from public.vendors where id = p_vendor_id and org_id = v_caller.org_id
  ) then
    raise exception 'vendor not found';
  end if;

  if p_department_id is not null
     and not exists (
       select 1 from public.departments
       where id = p_department_id and org_id = v_caller.org_id
     ) then
    raise exception 'department_id does not belong to this organization';
  end if;

  insert into public.contracts (
    org_id, vendor_id, name, cost_amount, currency, billing_cycle, seats_purchased,
    start_date, renewal_date, auto_renews, cancellation_notice_days, document_url, department_id
  )
  values (
    v_caller.org_id, p_vendor_id, p_name, p_cost_amount, p_currency, p_billing_cycle, p_seats_purchased,
    p_start_date, p_renewal_date, p_auto_renews, p_cancellation_notice_days, p_document_url, p_department_id
  )
  returning id into v_contract_id;

  insert into public.audit_log (org_id, actor_id, action, entity, entity_id, diff)
  values (
    v_caller.org_id, v_caller.id, 'contract.created', 'contract', v_contract_id,
    jsonb_build_object(
      'vendor_id', p_vendor_id, 'name', p_name, 'cost_amount', p_cost_amount,
      'currency', p_currency, 'billing_cycle', p_billing_cycle, 'renewal_date', p_renewal_date,
      'department_id', p_department_id
    )
  );

  return v_contract_id;
end;
$$;

create function public.update_contract(
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
  p_department_id uuid default null
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

  if p_department_id is not null
     and not exists (
       select 1 from public.departments
       where id = p_department_id and org_id = v_caller.org_id
     ) then
    raise exception 'department_id does not belong to this organization';
  end if;

  update public.contracts
  set name = p_name, cost_amount = p_cost_amount, currency = p_currency,
      billing_cycle = p_billing_cycle, seats_purchased = p_seats_purchased,
      start_date = p_start_date, renewal_date = p_renewal_date, auto_renews = p_auto_renews,
      cancellation_notice_days = p_cancellation_notice_days, document_url = p_document_url,
      status = p_status, department_id = p_department_id, updated_at = now()
  where id = p_contract_id;

  insert into public.audit_log (org_id, actor_id, action, entity, entity_id, diff)
  values (
    v_caller.org_id, v_caller.id, 'contract.updated', 'contract', p_contract_id,
    jsonb_build_object(
      'old', jsonb_build_object(
        'name', v_contract.name, 'cost_amount', v_contract.cost_amount, 'currency', v_contract.currency,
        'billing_cycle', v_contract.billing_cycle, 'renewal_date', v_contract.renewal_date,
        'document_url', v_contract.document_url, 'status', v_contract.status,
        'department_id', v_contract.department_id
      ),
      'new', jsonb_build_object(
        'name', p_name, 'cost_amount', p_cost_amount, 'currency', p_currency,
        'billing_cycle', p_billing_cycle, 'renewal_date', p_renewal_date,
        'document_url', p_document_url, 'status', p_status, 'department_id', p_department_id
      )
    )
  );
end;
$$;

-- =========================================================================
-- 2. exchange_rates — tabla global (sin org_id), mismo patrón que
--    saas_catalog: solo lectura para clientes, escrita únicamente por
--    migración. Dato estático/manual (regla 7 de CLAUDE.md: nada de APIs de
--    terceros hasta Fase 5); el refresco periódico real necesita la
--    infraestructura de cron del bloque 2.1, no antes.
-- =========================================================================

create table public.exchange_rates (
  base_currency char(3) not null,
  quote_currency char(3) not null,
  rate numeric(18, 8) not null check (rate > 0),
  as_of date not null,
  primary key (base_currency, quote_currency)
);

alter table public.exchange_rates enable row level security;

create policy exchange_rates_select on public.exchange_rates
  for select
  to authenticated
  using (true);

create policy exchange_rates_no_insert on public.exchange_rates
  for insert
  with check (false);

create policy exchange_rates_no_update on public.exchange_rates
  for update
  using (false);

create policy exchange_rates_no_delete on public.exchange_rates
  for delete
  using (false);

-- Fecha literal fija (determinismo entre entornos) — pares comunes de
-- facturación SaaS, ambas direcciones para no depender de inversión en cada
-- lookup.
insert into public.exchange_rates (base_currency, quote_currency, rate, as_of)
values
  ('EUR', 'USD', 1.08, '2026-07-01'),
  ('USD', 'EUR', 0.93, '2026-07-01'),
  ('EUR', 'GBP', 0.86, '2026-07-01'),
  ('GBP', 'EUR', 1.16, '2026-07-01'),
  ('EUR', 'CHF', 0.94, '2026-07-01'),
  ('CHF', 'EUR', 1.06, '2026-07-01');
