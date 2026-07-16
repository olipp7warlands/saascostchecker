-- Feedback de uso real: soporte multi-empresa (grupos con varias sociedades).
-- Tabla: companies. Dimensión INDEPENDIENTE de departments (empresa = quién
-- paga, departamento = quién usa; los departamentos son transversales al
-- grupo) — ver docs/DECISIONS.md.
-- RPCs: create_company(), update_company(), delete_company() — mismo
-- esqueleto exacto que create_department()/update_department()/
-- delete_department() de 0002_departments.sql (org_admin-only, audit_log en
-- la misma transacción, mutaciones bloqueadas en RLS).
-- create_contract()/update_contract() se redefinen (drop + create, no
-- `create or replace`: cambia la lista de parámetros — misma lección de
-- proceso que 0011_dashboard.sql con department_id) para añadir
-- p_company_id.

-- =========================================================================
-- 1. TABLA
-- =========================================================================

create table public.companies (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  name text not null,
  tax_id text,
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, name)
);

-- Invariante: como mucho una empresa "por defecto" por org. Las RPCs de
-- abajo desmarcan la anterior antes de marcar una nueva, en la misma
-- transacción, para no violar este índice.
create unique index companies_org_default_unique_idx
  on public.companies (org_id)
  where is_default;

-- Empresa que paga un contrato (independiente de contracts.department_id,
-- que sigue siendo quién USA el contrato). Nullable: contratos sin empresa
-- caen a "Grupo / Sin asignar" en agregados, mismo patrón que
-- department_id (0011_dashboard.sql).
alter table public.contracts
  add column company_id uuid references public.companies (id) on delete set null;

create index contracts_company_id_idx on public.contracts (company_id);

-- =========================================================================
-- 2. RPCs de empresas (SECURITY DEFINER — solo org_admin, mismo criterio
-- que departments/usuarios en SPECS §5: no se pide explícitamente, pero se
-- trata como dato organizativo sensible igual que los departamentos)
-- =========================================================================

create function public.create_company(
  p_name text,
  p_tax_id text,
  p_is_default boolean default false
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller public.users%rowtype;
  v_company_id uuid;
begin
  select * into v_caller from public.users where auth_id = auth.uid();

  if v_caller.role <> 'org_admin' then
    raise exception 'insufficient privileges to create companies';
  end if;

  if p_is_default then
    update public.companies
    set is_default = false
    where org_id = v_caller.org_id and is_default;
  end if;

  insert into public.companies (org_id, name, tax_id, is_default)
  values (v_caller.org_id, p_name, p_tax_id, p_is_default)
  returning id into v_company_id;

  insert into public.audit_log (org_id, actor_id, action, entity, entity_id, diff)
  values (
    v_caller.org_id, v_caller.id, 'company.created', 'company', v_company_id,
    jsonb_build_object('name', p_name, 'tax_id', p_tax_id, 'is_default', p_is_default)
  );

  return v_company_id;
end;
$$;

create function public.update_company(
  p_company_id uuid,
  p_name text,
  p_tax_id text,
  p_is_default boolean
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller public.users%rowtype;
  v_company public.companies%rowtype;
begin
  select * into v_caller from public.users where auth_id = auth.uid();

  if v_caller.role <> 'org_admin' then
    raise exception 'insufficient privileges to update companies';
  end if;

  select * into v_company
  from public.companies
  where id = p_company_id and org_id = v_caller.org_id;

  if not found then
    raise exception 'company not found';
  end if;

  if p_is_default then
    update public.companies
    set is_default = false
    where org_id = v_caller.org_id and is_default and id <> p_company_id;
  end if;

  update public.companies
  set name = p_name, tax_id = p_tax_id, is_default = p_is_default, updated_at = now()
  where id = p_company_id;

  insert into public.audit_log (org_id, actor_id, action, entity, entity_id, diff)
  values (
    v_caller.org_id, v_caller.id, 'company.updated', 'company', p_company_id,
    jsonb_build_object(
      'old', jsonb_build_object(
        'name', v_company.name, 'tax_id', v_company.tax_id, 'is_default', v_company.is_default
      ),
      'new', jsonb_build_object(
        'name', p_name, 'tax_id', p_tax_id, 'is_default', p_is_default
      )
    )
  );
end;
$$;

create function public.delete_company(p_company_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller public.users%rowtype;
  v_company public.companies%rowtype;
begin
  select * into v_caller from public.users where auth_id = auth.uid();

  if v_caller.role <> 'org_admin' then
    raise exception 'insufficient privileges to delete companies';
  end if;

  select * into v_company
  from public.companies
  where id = p_company_id and org_id = v_caller.org_id;

  if not found then
    raise exception 'company not found';
  end if;

  -- Sin chequeo de contratos en uso: contracts.company_id es
  -- "on delete set null" (igual que department_id) — los contratos
  -- afectados caen a "Grupo / Sin asignar" en vez de bloquear el borrado.
  delete from public.companies where id = p_company_id;

  insert into public.audit_log (org_id, actor_id, action, entity, entity_id, diff)
  values (
    v_caller.org_id, v_caller.id, 'company.deleted', 'company', p_company_id,
    jsonb_build_object('name', v_company.name)
  );
end;
$$;

-- =========================================================================
-- 3. create_contract() / update_contract() — añadir p_company_id
-- =========================================================================

drop function public.create_contract(
  uuid, text, numeric, char(3), text, integer, date, date, boolean, integer, text, uuid
);
drop function public.update_contract(
  uuid, text, numeric, char(3), text, integer, date, date, boolean, integer, text, text, uuid
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
  p_department_id uuid default null,
  p_company_id uuid default null
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

  if p_company_id is not null
     and not exists (
       select 1 from public.companies
       where id = p_company_id and org_id = v_caller.org_id
     ) then
    raise exception 'company_id does not belong to this organization';
  end if;

  insert into public.contracts (
    org_id, vendor_id, name, cost_amount, currency, billing_cycle, seats_purchased,
    start_date, renewal_date, auto_renews, cancellation_notice_days, document_url,
    department_id, company_id
  )
  values (
    v_caller.org_id, p_vendor_id, p_name, p_cost_amount, p_currency, p_billing_cycle, p_seats_purchased,
    p_start_date, p_renewal_date, p_auto_renews, p_cancellation_notice_days, p_document_url,
    p_department_id, p_company_id
  )
  returning id into v_contract_id;

  insert into public.audit_log (org_id, actor_id, action, entity, entity_id, diff)
  values (
    v_caller.org_id, v_caller.id, 'contract.created', 'contract', v_contract_id,
    jsonb_build_object(
      'vendor_id', p_vendor_id, 'name', p_name, 'cost_amount', p_cost_amount,
      'currency', p_currency, 'billing_cycle', p_billing_cycle, 'renewal_date', p_renewal_date,
      'department_id', p_department_id, 'company_id', p_company_id
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
-- 4. ROW LEVEL SECURITY
-- =========================================================================

alter table public.companies enable row level security;

-- Visible a toda la org (desplegables del formulario de contrato), igual
-- que departments; toda mutación pasa por las RPCs de arriba.
create policy companies_select on public.companies
  for select
  using (org_id = public.current_org_id());

create policy companies_no_insert on public.companies
  for insert
  with check (false);

create policy companies_no_update on public.companies
  for update
  using (false);

create policy companies_no_delete on public.companies
  for delete
  using (false);
