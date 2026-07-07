-- Bloque 0.3 — Usuarios y departamentos
-- Tabla: departments. Columna diferida: users.department_id (ver DECISIONS.md 0.2)
-- Refuerzo: protect_users_columns() ahora exige que role/department_id se
-- cambien SIEMPRE a través de una RPC (garantiza cobertura total de audit_log).
-- RPCs: create_department(), update_department(), delete_department(),
--       update_user_role(), update_user_department()

-- =========================================================================
-- 1. TABLA
-- =========================================================================

create table public.departments (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  name text not null,
  manager_user_id uuid references public.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, name)
);

alter table public.users
  add column department_id uuid references public.departments (id) on delete set null;

-- =========================================================================
-- 2. REFUERZO: protect_users_columns()
-- RLS no puede restringir columnas individuales; ya existía un chequeo de rol
-- para `role`, pero dejaba pasar el cambio si el caller era org_admin (sin
-- garantizar que la mutación pase por una RPC auditada). Ahora el cambio de
-- `role` o `department_id` exige que la transacción actual lo autorice
-- explícitamente vía un flag local (set_config(..., true)) que solo ponen las
-- RPCs de abajo — así ningún camino (ni siquiera un update directo de
-- org_admin) puede saltarse audit_log.
-- =========================================================================

create or replace function public.protect_users_columns()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.org_id <> old.org_id then
    raise exception 'org_id is immutable';
  end if;

  if new.role <> old.role
     and coalesce(current_setting('stackly.bypass_user_column_guard', true), '') <> 'on' then
    raise exception 'role must be changed via update_user_role()';
  end if;

  if new.department_id is distinct from old.department_id
     and coalesce(current_setting('stackly.bypass_user_column_guard', true), '') <> 'on' then
    raise exception 'department_id must be changed via update_user_department()';
  end if;

  return new;
end;
$$;

-- =========================================================================
-- 3. RPCs de departamentos (SECURITY DEFINER — solo org_admin, SPECS §5)
-- =========================================================================

create function public.create_department(p_name text, p_manager_user_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller public.users%rowtype;
  v_department_id uuid;
begin
  select * into v_caller from public.users where auth_id = auth.uid();

  if v_caller.role <> 'org_admin' then
    raise exception 'insufficient privileges to create departments';
  end if;

  if p_manager_user_id is not null
     and not exists (
       select 1 from public.users
       where id = p_manager_user_id and org_id = v_caller.org_id
     ) then
    raise exception 'manager_user_id does not belong to this organization';
  end if;

  insert into public.departments (org_id, name, manager_user_id)
  values (v_caller.org_id, p_name, p_manager_user_id)
  returning id into v_department_id;

  insert into public.audit_log (org_id, actor_id, action, entity, entity_id, diff)
  values (
    v_caller.org_id, v_caller.id, 'department.created', 'department', v_department_id,
    jsonb_build_object('name', p_name, 'manager_user_id', p_manager_user_id)
  );

  return v_department_id;
end;
$$;

create function public.update_department(
  p_department_id uuid,
  p_name text,
  p_manager_user_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller public.users%rowtype;
  v_department public.departments%rowtype;
begin
  select * into v_caller from public.users where auth_id = auth.uid();

  if v_caller.role <> 'org_admin' then
    raise exception 'insufficient privileges to update departments';
  end if;

  select * into v_department
  from public.departments
  where id = p_department_id and org_id = v_caller.org_id;

  if not found then
    raise exception 'department not found';
  end if;

  if p_manager_user_id is not null
     and not exists (
       select 1 from public.users
       where id = p_manager_user_id and org_id = v_caller.org_id
     ) then
    raise exception 'manager_user_id does not belong to this organization';
  end if;

  update public.departments
  set name = p_name, manager_user_id = p_manager_user_id, updated_at = now()
  where id = p_department_id;

  insert into public.audit_log (org_id, actor_id, action, entity, entity_id, diff)
  values (
    v_caller.org_id, v_caller.id, 'department.updated', 'department', p_department_id,
    jsonb_build_object(
      'old', jsonb_build_object('name', v_department.name, 'manager_user_id', v_department.manager_user_id),
      'new', jsonb_build_object('name', p_name, 'manager_user_id', p_manager_user_id)
    )
  );
end;
$$;

create function public.delete_department(p_department_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller public.users%rowtype;
  v_department public.departments%rowtype;
begin
  select * into v_caller from public.users where auth_id = auth.uid();

  if v_caller.role <> 'org_admin' then
    raise exception 'insufficient privileges to delete departments';
  end if;

  select * into v_department
  from public.departments
  where id = p_department_id and org_id = v_caller.org_id;

  if not found then
    raise exception 'department not found';
  end if;

  delete from public.departments where id = p_department_id;

  insert into public.audit_log (org_id, actor_id, action, entity, entity_id, diff)
  values (
    v_caller.org_id, v_caller.id, 'department.deleted', 'department', p_department_id,
    jsonb_build_object('name', v_department.name)
  );
end;
$$;

-- =========================================================================
-- 4. RPCs de gestión de usuarios (SECURITY DEFINER — solo org_admin)
-- =========================================================================

create function public.update_user_role(p_user_id uuid, p_new_role text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller public.users%rowtype;
  v_target public.users%rowtype;
begin
  select * into v_caller from public.users where auth_id = auth.uid();

  if v_caller.role <> 'org_admin' then
    raise exception 'insufficient privileges to change roles';
  end if;

  select * into v_target
  from public.users
  where id = p_user_id and org_id = v_caller.org_id;

  if not found then
    raise exception 'user not found';
  end if;

  perform set_config('stackly.bypass_user_column_guard', 'on', true);

  update public.users set role = p_new_role where id = p_user_id;

  insert into public.audit_log (org_id, actor_id, action, entity, entity_id, diff)
  values (
    v_caller.org_id, v_caller.id, 'user.role_updated', 'user', p_user_id,
    jsonb_build_object('old_role', v_target.role, 'new_role', p_new_role)
  );
end;
$$;

create function public.update_user_department(p_user_id uuid, p_department_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller public.users%rowtype;
  v_target public.users%rowtype;
begin
  select * into v_caller from public.users where auth_id = auth.uid();

  if v_caller.role <> 'org_admin' then
    raise exception 'insufficient privileges to change departments';
  end if;

  select * into v_target
  from public.users
  where id = p_user_id and org_id = v_caller.org_id;

  if not found then
    raise exception 'user not found';
  end if;

  if p_department_id is not null
     and not exists (
       select 1 from public.departments
       where id = p_department_id and org_id = v_caller.org_id
     ) then
    raise exception 'department not found';
  end if;

  perform set_config('stackly.bypass_user_column_guard', 'on', true);

  update public.users set department_id = p_department_id where id = p_user_id;

  insert into public.audit_log (org_id, actor_id, action, entity, entity_id, diff)
  values (
    v_caller.org_id, v_caller.id, 'user.department_updated', 'user', p_user_id,
    jsonb_build_object('old_department_id', v_target.department_id, 'new_department_id', p_department_id)
  );
end;
$$;

-- =========================================================================
-- 5. ROW LEVEL SECURITY
-- =========================================================================

alter table public.departments enable row level security;

-- departments: visible a toda la org (desplegables); toda mutación pasa por
-- las RPCs de arriba (mismo patrón que invitations/audit_log).
create policy departments_select on public.departments
  for select
  using (org_id = public.current_org_id());

create policy departments_no_insert on public.departments
  for insert
  with check (false);

create policy departments_no_update on public.departments
  for update
  using (false);

create policy departments_no_delete on public.departments
  for delete
  using (false);
