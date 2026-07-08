-- Bloque 1.2 — Vendors y contratos
-- Tablas: vendors, contracts (multi-tenant normales, org_id + RLS)
-- RPCs: create_vendor(), update_vendor(), delete_vendor(),
--       create_contract(), update_contract(), delete_contract()
-- Todas security definer: comprueban org_id + role in
-- ('finance','it_admin','org_admin') (SPECS §5) y escriben audit_log en la
-- misma transacción — mismo patrón que create_department()/update_user_role()
-- de 0002. RLS bloquea insert/update/delete directos (with check(false)),
-- igual que departments/invitations: toda mutación pasa por las RPCs.

-- =========================================================================
-- 1. TABLAS
-- =========================================================================

create table public.vendors (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  -- nullable: un vendor custom no viene del catálogo global.
  catalog_id uuid references public.saas_catalog (id) on delete set null,
  name text not null,
  website text not null,
  -- Mismo check de 16 slugs que saas_catalog (bloque 1.1) — copiado, no hay
  -- forma de compartir un enum entre tablas sin un tipo dedicado, y crear uno
  -- ahora para 2 tablas es sobreingeniería. Al crear desde catálogo se copia
  -- el valor de saas_catalog.category (snapshot); queda editable después.
  category text not null check (category in (
    'crm', 'marketing', 'sales', 'design', 'productivity', 'communication',
    'devtools', 'observability', 'security', 'analytics', 'hr', 'finance',
    'support', 'project_management', 'video', 'other'
  )),
  -- Sin usar, igual que en saas_catalog: <AppLogo domain> deriva siempre del
  -- favicon de `website`. Queda para una futura curación manual.
  logo_url text,
  status text not null default 'active' check (status in ('active', 'inactive', 'trial')),
  owner_user_id uuid references public.users (id) on delete set null,
  is_custom boolean not null default false,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index vendors_org_id_idx on public.vendors (org_id);

create table public.contracts (
  id uuid primary key default gen_random_uuid(),
  -- Redundante con vendors.org_id, pero es el patrón establecido en este
  -- proyecto (invitations/audit_log/departments también llevan org_id propio
  -- aunque cuelguen de otra fila con org_id) — evita RLS con subquery contra
  -- vendors en cada policy.
  org_id uuid not null references public.organizations (id) on delete cascade,
  -- Sin "on delete cascade" a propósito: borrar un vendor con contratos debe
  -- fallar con un error claro (delete_vendor() lo captura), no arrastrar el
  -- borrado silenciosamente.
  vendor_id uuid not null references public.vendors (id),
  name text not null,
  cost_amount numeric(14, 2) not null check (cost_amount >= 0),
  currency char(3) not null,
  billing_cycle text not null check (billing_cycle in ('monthly', 'annual', 'one_time')),
  seats_purchased integer check (seats_purchased >= 0),
  start_date date not null,
  renewal_date date not null,
  auto_renews boolean not null default true,
  cancellation_notice_days integer not null default 30 check (cancellation_notice_days >= 0),
  -- Ruta del objeto en el bucket privado `contracts` (org_id/contract_id/
  -- filename), NO una URL pública — el bucket es privado (ver migración
  -- 0006), la UI pide una signed URL al vuelo. El nombre de columna sigue a
  -- SPECS §4 literalmente aunque semánticamente sea un path.
  document_url text,
  status text not null default 'active' check (status in ('active', 'cancelled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index contracts_org_id_idx on public.contracts (org_id);
create index contracts_vendor_id_idx on public.contracts (vendor_id);

-- =========================================================================
-- 2. RPCs DE VENDORS
-- =========================================================================

create function public.create_vendor(
  p_catalog_id uuid,
  p_name text,
  p_website text,
  p_category text,
  p_owner_user_id uuid,
  p_is_custom boolean,
  p_notes text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller public.users%rowtype;
  v_vendor_id uuid;
begin
  select * into v_caller from public.users where auth_id = auth.uid();

  if v_caller.role not in ('finance', 'it_admin', 'org_admin') then
    raise exception 'insufficient privileges to create vendors';
  end if;

  if p_owner_user_id is not null
     and not exists (
       select 1 from public.users
       where id = p_owner_user_id and org_id = v_caller.org_id
     ) then
    raise exception 'owner_user_id does not belong to this organization';
  end if;

  insert into public.vendors (org_id, catalog_id, name, website, category, owner_user_id, is_custom, notes)
  values (v_caller.org_id, p_catalog_id, p_name, p_website, p_category, p_owner_user_id, p_is_custom, p_notes)
  returning id into v_vendor_id;

  insert into public.audit_log (org_id, actor_id, action, entity, entity_id, diff)
  values (
    v_caller.org_id, v_caller.id, 'vendor.created', 'vendor', v_vendor_id,
    jsonb_build_object('name', p_name, 'is_custom', p_is_custom, 'catalog_id', p_catalog_id)
  );

  return v_vendor_id;
end;
$$;

create function public.update_vendor(
  p_vendor_id uuid,
  p_name text,
  p_website text,
  p_category text,
  p_owner_user_id uuid,
  p_status text,
  p_notes text
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

  if p_owner_user_id is not null
     and not exists (
       select 1 from public.users
       where id = p_owner_user_id and org_id = v_caller.org_id
     ) then
    raise exception 'owner_user_id does not belong to this organization';
  end if;

  update public.vendors
  set name = p_name, website = p_website, category = p_category,
      owner_user_id = p_owner_user_id, status = p_status, notes = p_notes,
      updated_at = now()
  where id = p_vendor_id;

  insert into public.audit_log (org_id, actor_id, action, entity, entity_id, diff)
  values (
    v_caller.org_id, v_caller.id, 'vendor.updated', 'vendor', p_vendor_id,
    jsonb_build_object(
      'old', jsonb_build_object(
        'name', v_vendor.name, 'website', v_vendor.website, 'category', v_vendor.category,
        'owner_user_id', v_vendor.owner_user_id, 'status', v_vendor.status, 'notes', v_vendor.notes
      ),
      'new', jsonb_build_object(
        'name', p_name, 'website', p_website, 'category', p_category,
        'owner_user_id', p_owner_user_id, 'status', p_status, 'notes', p_notes
      )
    )
  );
end;
$$;

create function public.delete_vendor(p_vendor_id uuid)
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
    raise exception 'insufficient privileges to delete vendors';
  end if;

  select * into v_vendor from public.vendors where id = p_vendor_id and org_id = v_caller.org_id;

  if not found then
    raise exception 'vendor not found';
  end if;

  -- Sin cascade: si quedan contratos, la FK de contracts.vendor_id lanza un
  -- error claro (foreign_key_violation) en vez de borrarlos en silencio.
  delete from public.vendors where id = p_vendor_id;

  insert into public.audit_log (org_id, actor_id, action, entity, entity_id, diff)
  values (
    v_caller.org_id, v_caller.id, 'vendor.deleted', 'vendor', p_vendor_id,
    jsonb_build_object('name', v_vendor.name)
  );
end;
$$;

-- =========================================================================
-- 3. RPCs DE CONTRACTS
-- =========================================================================

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
  p_document_url text
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

  insert into public.contracts (
    org_id, vendor_id, name, cost_amount, currency, billing_cycle, seats_purchased,
    start_date, renewal_date, auto_renews, cancellation_notice_days, document_url
  )
  values (
    v_caller.org_id, p_vendor_id, p_name, p_cost_amount, p_currency, p_billing_cycle, p_seats_purchased,
    p_start_date, p_renewal_date, p_auto_renews, p_cancellation_notice_days, p_document_url
  )
  returning id into v_contract_id;

  insert into public.audit_log (org_id, actor_id, action, entity, entity_id, diff)
  values (
    v_caller.org_id, v_caller.id, 'contract.created', 'contract', v_contract_id,
    jsonb_build_object(
      'vendor_id', p_vendor_id, 'name', p_name, 'cost_amount', p_cost_amount,
      'currency', p_currency, 'billing_cycle', p_billing_cycle, 'renewal_date', p_renewal_date
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
  p_status text
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

  update public.contracts
  set name = p_name, cost_amount = p_cost_amount, currency = p_currency,
      billing_cycle = p_billing_cycle, seats_purchased = p_seats_purchased,
      start_date = p_start_date, renewal_date = p_renewal_date, auto_renews = p_auto_renews,
      cancellation_notice_days = p_cancellation_notice_days, document_url = p_document_url,
      status = p_status, updated_at = now()
  where id = p_contract_id;

  insert into public.audit_log (org_id, actor_id, action, entity, entity_id, diff)
  values (
    v_caller.org_id, v_caller.id, 'contract.updated', 'contract', p_contract_id,
    jsonb_build_object(
      'old', jsonb_build_object(
        'name', v_contract.name, 'cost_amount', v_contract.cost_amount, 'currency', v_contract.currency,
        'billing_cycle', v_contract.billing_cycle, 'renewal_date', v_contract.renewal_date,
        'document_url', v_contract.document_url, 'status', v_contract.status
      ),
      'new', jsonb_build_object(
        'name', p_name, 'cost_amount', p_cost_amount, 'currency', p_currency,
        'billing_cycle', p_billing_cycle, 'renewal_date', p_renewal_date,
        'document_url', p_document_url, 'status', p_status
      )
    )
  );
end;
$$;

create function public.delete_contract(p_contract_id uuid)
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
    raise exception 'insufficient privileges to delete contracts';
  end if;

  select * into v_contract from public.contracts where id = p_contract_id and org_id = v_caller.org_id;

  if not found then
    raise exception 'contract not found';
  end if;

  delete from public.contracts where id = p_contract_id;

  insert into public.audit_log (org_id, actor_id, action, entity, entity_id, diff)
  values (
    v_caller.org_id, v_caller.id, 'contract.deleted', 'contract', p_contract_id,
    jsonb_build_object('vendor_id', v_contract.vendor_id, 'name', v_contract.name)
  );
end;
$$;

-- =========================================================================
-- 4. ROW LEVEL SECURITY
-- =========================================================================

alter table public.vendors enable row level security;
alter table public.contracts enable row level security;

-- A diferencia de departments (visible a toda la org), vendors/contracts
-- exigen rol en el SELECT: SPECS §5 los da a finance/it_admin/org_admin, no a
-- todo miembro autenticado. Esto hace cumplir en el servidor lo que el nav
-- del bloque 0.4 ya oculta en la UI (CLAUDE.md: "la UI solo oculta").
create policy vendors_select on public.vendors
  for select
  using (org_id = public.current_org_id() and public.current_user_role() in ('finance', 'it_admin', 'org_admin'));

create policy vendors_no_insert on public.vendors
  for insert
  with check (false);

create policy vendors_no_update on public.vendors
  for update
  using (false);

create policy vendors_no_delete on public.vendors
  for delete
  using (false);

create policy contracts_select on public.contracts
  for select
  using (org_id = public.current_org_id() and public.current_user_role() in ('finance', 'it_admin', 'org_admin'));

create policy contracts_no_insert on public.contracts
  for insert
  with check (false);

create policy contracts_no_update on public.contracts
  for update
  using (false);

create policy contracts_no_delete on public.contracts
  for delete
  using (false);
