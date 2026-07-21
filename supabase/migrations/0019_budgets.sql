-- Bloque nuevo (fuera de la numeración de fases, ver docs/DECISIONS.md):
-- presupuestos por bolsa departamento x empresa x año fiscal. Cierra la
-- deuda dejada explícitamente en el bloque 1.5 ("vs. presupuesto" quedó
-- fuera porque no existía ningún concepto de presupuesto en el modelo).
--
-- Tabla: budgets. RPCs: create_budget(), update_budget(), delete_budget() —
-- mismo esqueleto que create_company()/update_company()/delete_company()
-- (0013_companies.sql), pero con un rol de escritura MÁS ESTRECHO
-- (BUDGET_WRITE_ROLES = finance + org_admin, sin it_admin) que el resto de
-- mutaciones de vendors/contracts/companies (MANAGER_ROLES) — decisión de
-- negocio explícita del usuario: el presupuesto lo aprueban finance +
-- dirección, no IT. La LECTURA sigue el criterio MANAGER_ROLES estándar
-- (finance/it_admin/org_admin), igual que vendors/contracts.
--
-- vendors.annual_cap: cap anual informativo propio del vendor, no participa
-- en el cálculo de consumo de bolsas (que es 100% departamento x empresa).

-- =========================================================================
-- 1. TABLA
-- =========================================================================

create table public.budgets (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  -- Ambos nullable, pero no los dos a la vez (ver check abajo): permite 3
  -- formas de bolsa (depto+empresa, depto para todas las empresas, empresa
  -- entera sin desglose) sin 3 tablas distintas.
  company_id uuid references public.companies (id) on delete cascade,
  department_id uuid references public.departments (id) on delete cascade,
  fiscal_year integer not null check (fiscal_year between 2000 and 2100),
  amount numeric(14, 2) not null check (amount >= 0),
  currency char(3) not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint budgets_scope_not_fully_global check (company_id is not null or department_id is not null)
);

-- Como mucho una bolsa por combinación (empresa, departamento, año) en una
-- org, tratando null como su propio valor de "todas/sin desglose" —
-- coalesce a un uuid nil fijo en vez de nullable en la unique normal (una
-- unique constraint normal no bloquea duplicados con NULL, que Postgres
-- trata como distintos entre sí).
create unique index budgets_scope_unique_idx on public.budgets (
  org_id,
  coalesce(company_id, '00000000-0000-0000-0000-000000000000'::uuid),
  coalesce(department_id, '00000000-0000-0000-0000-000000000000'::uuid),
  fiscal_year
);

create index budgets_org_id_idx on public.budgets (org_id);

-- Cap anual informativo, ajeno al cálculo de consumo de bolsas.
alter table public.vendors add column annual_cap numeric(14, 2) check (annual_cap >= 0);
alter table public.vendors add column annual_cap_currency char(3);

-- =========================================================================
-- 2. RPCs
-- =========================================================================

create function public.create_budget(
  p_company_id uuid,
  p_department_id uuid,
  p_fiscal_year integer,
  p_amount numeric,
  p_currency char(3)
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller public.users%rowtype;
  v_budget_id uuid;
begin
  select * into v_caller from public.users where auth_id = auth.uid();

  if v_caller.role not in ('finance', 'org_admin') then
    raise exception 'insufficient privileges to create budgets';
  end if;

  if p_company_id is null and p_department_id is null then
    raise exception 'a budget must scope to a company, a department, or both';
  end if;

  if p_company_id is not null
     and not exists (
       select 1 from public.companies where id = p_company_id and org_id = v_caller.org_id
     ) then
    raise exception 'company_id does not belong to this organization';
  end if;

  if p_department_id is not null
     and not exists (
       select 1 from public.departments where id = p_department_id and org_id = v_caller.org_id
     ) then
    raise exception 'department_id does not belong to this organization';
  end if;

  insert into public.budgets (org_id, company_id, department_id, fiscal_year, amount, currency)
  values (v_caller.org_id, p_company_id, p_department_id, p_fiscal_year, p_amount, p_currency)
  returning id into v_budget_id;

  insert into public.audit_log (org_id, actor_id, action, entity, entity_id, diff)
  values (
    v_caller.org_id, v_caller.id, 'budget.created', 'budget', v_budget_id,
    jsonb_build_object(
      'company_id', p_company_id, 'department_id', p_department_id,
      'fiscal_year', p_fiscal_year, 'amount', p_amount, 'currency', p_currency
    )
  );

  return v_budget_id;
end;
$$;

create function public.update_budget(
  p_budget_id uuid,
  p_amount numeric,
  p_currency char(3)
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller public.users%rowtype;
  v_budget public.budgets%rowtype;
begin
  select * into v_caller from public.users where auth_id = auth.uid();

  if v_caller.role not in ('finance', 'org_admin') then
    raise exception 'insufficient privileges to update budgets';
  end if;

  select * into v_budget from public.budgets where id = p_budget_id and org_id = v_caller.org_id;

  if not found then
    raise exception 'budget not found';
  end if;

  -- Solo importe/moneda son editables: cambiar de bolsa (empresa/depto/año)
  -- es conceptualmente crear una bolsa distinta, no editar la existente
  -- (evita colisionar con budgets_scope_unique_idx a medio editar).
  update public.budgets
  set amount = p_amount, currency = p_currency, updated_at = now()
  where id = p_budget_id;

  insert into public.audit_log (org_id, actor_id, action, entity, entity_id, diff)
  values (
    v_caller.org_id, v_caller.id, 'budget.updated', 'budget', p_budget_id,
    jsonb_build_object(
      'old', jsonb_build_object('amount', v_budget.amount, 'currency', v_budget.currency),
      'new', jsonb_build_object('amount', p_amount, 'currency', p_currency)
    )
  );
end;
$$;

create function public.delete_budget(p_budget_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller public.users%rowtype;
  v_budget public.budgets%rowtype;
begin
  select * into v_caller from public.users where auth_id = auth.uid();

  if v_caller.role not in ('finance', 'org_admin') then
    raise exception 'insufficient privileges to delete budgets';
  end if;

  select * into v_budget from public.budgets where id = p_budget_id and org_id = v_caller.org_id;

  if not found then
    raise exception 'budget not found';
  end if;

  delete from public.budgets where id = p_budget_id;

  insert into public.audit_log (org_id, actor_id, action, entity, entity_id, diff)
  values (
    v_caller.org_id, v_caller.id, 'budget.deleted', 'budget', p_budget_id,
    jsonb_build_object(
      'company_id', v_budget.company_id, 'department_id', v_budget.department_id,
      'fiscal_year', v_budget.fiscal_year, 'amount', v_budget.amount, 'currency', v_budget.currency
    )
  );
end;
$$;

create function public.update_vendor_annual_cap(
  p_vendor_id uuid,
  p_annual_cap numeric,
  p_annual_cap_currency char(3)
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller public.users%rowtype;
  v_vendor public.vendors%rowtype;
begin
  select * into v_caller from public.users where auth_id = auth.uid();

  if v_caller.role not in ('finance', 'it_admin', 'org_admin') then
    raise exception 'insufficient privileges to update vendors';
  end if;

  select * into v_vendor from public.vendors where id = p_vendor_id and org_id = v_caller.org_id;

  if not found then
    raise exception 'vendor not found';
  end if;

  if p_annual_cap is not null and p_annual_cap_currency is null then
    raise exception 'annual_cap_currency is required when annual_cap is set';
  end if;

  update public.vendors
  set annual_cap = p_annual_cap, annual_cap_currency = p_annual_cap_currency, updated_at = now()
  where id = p_vendor_id;

  insert into public.audit_log (org_id, actor_id, action, entity, entity_id, diff)
  values (
    v_caller.org_id, v_caller.id, 'vendor.updated', 'vendor', p_vendor_id,
    jsonb_build_object(
      'old', jsonb_build_object(
        'annual_cap', v_vendor.annual_cap, 'annual_cap_currency', v_vendor.annual_cap_currency
      ),
      'new', jsonb_build_object(
        'annual_cap', p_annual_cap, 'annual_cap_currency', p_annual_cap_currency
      )
    )
  );
end;
$$;

-- =========================================================================
-- 3. ROW LEVEL SECURITY
-- =========================================================================

alter table public.budgets enable row level security;

-- Lectura: MANAGER_ROLES estándar (finance/it_admin/org_admin), igual que
-- vendors/contracts — it_admin sigue viendo el impacto presupuestario de lo
-- que gestiona aunque no pueda editarlo. La escritura, más estrecha
-- (finance/org_admin), vive solo dentro de las RPCs de arriba.
create policy budgets_select on public.budgets
  for select
  using (org_id = public.current_org_id() and public.current_user_role() in ('finance', 'it_admin', 'org_admin'));

create policy budgets_no_insert on public.budgets
  for insert
  with check (false);

create policy budgets_no_update on public.budgets
  for update
  using (false);

create policy budgets_no_delete on public.budgets
  for delete
  using (false);
