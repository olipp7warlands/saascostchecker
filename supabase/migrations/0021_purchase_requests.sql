-- Bloque 3.1 — Solicitudes (formulario self-service de compra)
--
-- Alcance de este bloque, según docs/TASKS.md §3.1: migración de
-- purchase_requests + formulario self-service (autocompletado del catálogo)
-- + timeline visual de estados. El motor de aprobaciones completo
-- (approval_rules/approval_actions, links firmados, escalado — SPECS §6) es
-- el bloque 3.2, todavía no construido: una solicitud enviada aquí se queda
-- en 'pending' sin nada que la procese todavía, y eso es lo esperado.
--
-- Decisiones de alcance confirmadas con el usuario antes de escribir esta
-- migración: (1) sin flujo de "guardar borrador" — el formulario envía
-- directo a 'pending', 'draft' queda soportado en el constraint para el
-- futuro sin UI propia todavía; (2) visibilidad RLS solo del propio
-- solicitante (sin lectura ampliada para finance/it_admin/org_admin todavía
-- — eso se revisa en 3.2 cuando exista de verdad el motor).
--
-- RLS modelada sobre notifications_select (0015_renewal_alerts.sql), el
-- único precedente existente de ownership por fila en vez de por rol — toda
-- otra tabla del repo hasta ahora restringe lectura por MANAGER_ROLES.

-- =========================================================================
-- 1. TABLA
-- =========================================================================

create table public.purchase_requests (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  -- on delete cascade (no set null, a diferencia de vendors.owner_user_id):
  -- esta tabla no tiene todavía ninguna política de lectura ampliada a la
  -- que "reasignar" visibilidad si el solicitante se va — una solicitud sin
  -- requester_id no sería visible para nadie de todos modos.
  requester_id uuid not null references public.users (id) on delete cascade,
  catalog_id uuid references public.saas_catalog (id) on delete set null,
  vendor_name text not null check (length(trim(vendor_name)) > 0),
  estimated_annual_cost numeric(14, 2) not null check (estimated_annual_cost >= 0),
  currency char(3) not null,
  department_id uuid references public.departments (id) on delete set null,
  justification text not null check (length(trim(justification)) > 0),
  alternatives_considered text,
  status text not null default 'pending'
    check (status in ('draft', 'pending', 'approved', 'rejected', 'purchased')),
  -- Nullable, sin default: solo cobra sentido cuando el bloque 3.2
  -- materialice pasos reales de approval_rules. Ponerle un default hoy
  -- fingiría un flujo de aprobación que todavía no existe.
  current_step integer,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index purchase_requests_org_id_idx on public.purchase_requests (org_id);
create index purchase_requests_requester_idx
  on public.purchase_requests (requester_id, created_at desc);

-- =========================================================================
-- 2. RPC: create_purchase_request()
-- =========================================================================

-- Sin check de rol: cualquier empleado puede solicitar (roles: "all" en el
-- nav, SPECS §5 "employee: crear/ver sus solicitudes"). department_id cae al
-- propio del caller si no se pasa explícito.
create function public.create_purchase_request(
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

  return v_request_id;
end;
$$;

-- =========================================================================
-- 3. ROW LEVEL SECURITY
-- =========================================================================

alter table public.purchase_requests enable row level security;

create policy purchase_requests_select on public.purchase_requests
  for select
  using (org_id = public.current_org_id() and requester_id = public.current_user_id());

create policy purchase_requests_no_insert on public.purchase_requests
  for insert
  with check (false);

create policy purchase_requests_no_update on public.purchase_requests
  for update
  using (false);

create policy purchase_requests_no_delete on public.purchase_requests
  for delete
  using (false);
