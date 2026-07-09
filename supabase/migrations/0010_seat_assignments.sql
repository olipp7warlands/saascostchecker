-- Bloque 1.4 — Licencias manuales
-- Tabla: seat_assignments (SPECS §4: contract_id, user_id, source,
-- last_seen_active_at — el mismo campo que reutilizará el sync SSO de la
-- Fase 5 sin cambiar el modelo).
-- RPCs: assign_seat(), unassign_seat(), set_seat_active(). Mismo patrón que
-- 0005/0007: security definer, comprueban org_id + role in
-- ('finance','it_admin','org_admin') y escriben audit_log en la misma
-- transacción. RLS bloquea insert/update/delete directos: toda mutación
-- pasa por estas RPCs.

-- =========================================================================
-- 1. TABLA
-- =========================================================================

create table public.seat_assignments (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  -- A diferencia de contracts.vendor_id (0005, sin cascade a propósito), un
  -- seat_assignment no tiene sentido sin su contrato — borrar el contrato
  -- debe liberar sus asientos, mismo criterio que
  -- reconciliation_queue.spend_record_id (0007).
  contract_id uuid not null references public.contracts (id) on delete cascade,
  user_id uuid not null references public.users (id) on delete cascade,
  source text not null default 'manual' check (source in ('manual', 'sso_sync')),
  -- "Activo" = not null (asumido en uso al asignar manualmente). El toggle
  -- "marcar inactivo" lo limpia a null. En Fase 5 el sync SSO sobrescribe
  -- esta misma columna con timestamps reales de login sin cambiar el modelo.
  last_seen_active_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Un usuario solo puede tener un asiento por contrato.
  unique (contract_id, user_id)
);

create index seat_assignments_org_id_idx on public.seat_assignments (org_id);
create index seat_assignments_contract_id_idx on public.seat_assignments (contract_id);
create index seat_assignments_user_id_idx on public.seat_assignments (user_id);

-- =========================================================================
-- 2. RPCs
-- =========================================================================

-- Exceso de asientos: PERMITIDO pero señalado (criterio literal de
-- docs/TASKS.md 1.4, "pasa en la vida real"). Devuelve over_capacity para
-- que la UI muestre un aviso no bloqueante justo tras asignar, sin una
-- segunda llamada; también queda en el diff de audit_log.
create function public.assign_seat(
  p_contract_id uuid,
  p_user_id uuid
)
returns table (seat_id uuid, over_capacity boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller public.users%rowtype;
  v_contract public.contracts%rowtype;
  v_seat_id uuid;
  v_assigned_count integer;
  v_over_capacity boolean;
begin
  select * into v_caller from public.users where auth_id = auth.uid();

  if v_caller.role not in ('finance', 'it_admin', 'org_admin') then
    raise exception 'insufficient privileges to assign seats';
  end if;

  select * into v_contract from public.contracts where id = p_contract_id and org_id = v_caller.org_id;

  if not found then
    raise exception 'contract not found';
  end if;

  if not exists (
    select 1 from public.users where id = p_user_id and org_id = v_caller.org_id
  ) then
    raise exception 'user does not belong to this organization';
  end if;

  if exists (
    select 1 from public.seat_assignments
    where contract_id = p_contract_id and user_id = p_user_id
  ) then
    raise exception 'user already has a seat on this contract';
  end if;

  insert into public.seat_assignments (org_id, contract_id, user_id, source, last_seen_active_at)
  values (v_caller.org_id, p_contract_id, p_user_id, 'manual', now())
  returning id into v_seat_id;

  select count(*) into v_assigned_count
  from public.seat_assignments
  where contract_id = p_contract_id;

  v_over_capacity := v_contract.seats_purchased is not null and v_assigned_count > v_contract.seats_purchased;

  insert into public.audit_log (org_id, actor_id, action, entity, entity_id, diff)
  values (
    v_caller.org_id, v_caller.id, 'seat_assignment.created', 'seat_assignment', v_seat_id,
    jsonb_build_object(
      'contract_id', p_contract_id, 'user_id', p_user_id, 'over_capacity', v_over_capacity
    )
  );

  return query select v_seat_id, v_over_capacity;
end;
$$;

create function public.unassign_seat(p_seat_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller public.users%rowtype;
  v_seat public.seat_assignments%rowtype;
begin
  select * into v_caller from public.users where auth_id = auth.uid();

  if v_caller.role not in ('finance', 'it_admin', 'org_admin') then
    raise exception 'insufficient privileges to unassign seats';
  end if;

  select * into v_seat from public.seat_assignments where id = p_seat_id and org_id = v_caller.org_id;

  if not found then
    raise exception 'seat assignment not found';
  end if;

  delete from public.seat_assignments where id = p_seat_id;

  insert into public.audit_log (org_id, actor_id, action, entity, entity_id, diff)
  values (
    v_caller.org_id, v_caller.id, 'seat_assignment.deleted', 'seat_assignment', p_seat_id,
    jsonb_build_object('contract_id', v_seat.contract_id, 'user_id', v_seat.user_id)
  );
end;
$$;

create function public.set_seat_active(
  p_seat_id uuid,
  p_active boolean
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller public.users%rowtype;
  v_seat public.seat_assignments%rowtype;
begin
  select * into v_caller from public.users where auth_id = auth.uid();

  if v_caller.role not in ('finance', 'it_admin', 'org_admin') then
    raise exception 'insufficient privileges to update seat assignments';
  end if;

  select * into v_seat from public.seat_assignments where id = p_seat_id and org_id = v_caller.org_id;

  if not found then
    raise exception 'seat assignment not found';
  end if;

  update public.seat_assignments
  set last_seen_active_at = case when p_active then now() else null end,
      updated_at = now()
  where id = p_seat_id;

  insert into public.audit_log (org_id, actor_id, action, entity, entity_id, diff)
  values (
    v_caller.org_id, v_caller.id, 'seat_assignment.updated', 'seat_assignment', p_seat_id,
    jsonb_build_object(
      'old', jsonb_build_object('active', v_seat.last_seen_active_at is not null),
      'new', jsonb_build_object('active', p_active)
    )
  );
end;
$$;

-- =========================================================================
-- 3. ROW LEVEL SECURITY
-- =========================================================================

alter table public.seat_assignments enable row level security;

create policy seat_assignments_select on public.seat_assignments
  for select
  using (org_id = public.current_org_id() and public.current_user_role() in ('finance', 'it_admin', 'org_admin'));

create policy seat_assignments_no_insert on public.seat_assignments
  for insert
  with check (false);

create policy seat_assignments_no_update on public.seat_assignments
  for update
  using (false);

create policy seat_assignments_no_delete on public.seat_assignments
  for delete
  using (false);
