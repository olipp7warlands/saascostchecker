-- Bloque 0.2 — Multi-tenancy y Auth
-- Tablas: organizations, users, invitations, audit_log
-- Helpers: current_org_id(), current_user_role()
-- Triggers: handle_new_user() (alta de org/usuario al registrarse), protect_users_columns()
-- RPCs: create_invitation(), revoke_invitation()

-- =========================================================================
-- 1. TABLAS
-- =========================================================================

create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  default_currency char(3) not null default 'EUR',
  locale text not null default 'es' check (locale in ('es', 'en')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.users (
  id uuid primary key default gen_random_uuid(),
  auth_id uuid not null unique references auth.users (id) on delete cascade,
  org_id uuid not null references public.organizations (id) on delete cascade,
  email text not null,
  full_name text,
  role text not null default 'employee'
    check (role in ('employee', 'manager', 'finance', 'it_admin', 'org_admin')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, email)
);

create table public.invitations (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  email text not null,
  role text not null
    check (role in ('employee', 'manager', 'finance', 'it_admin', 'org_admin')),
  token_hash text not null unique,
  invited_by uuid not null references public.users (id) on delete cascade,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);

-- Solo una invitación pendiente por email/org a la vez (permite reinvitar tras expirar/usar).
create unique index invitations_pending_unique
  on public.invitations (org_id, lower(email))
  where used_at is null;

create table public.audit_log (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  actor_id uuid references public.users (id) on delete set null,
  action text not null,
  entity text not null,
  entity_id uuid,
  diff jsonb,
  ip inet,
  created_at timestamptz not null default now()
);

-- =========================================================================
-- 2. HELPERS (SECURITY DEFINER, search_path fijado — hardening estándar)
-- =========================================================================

create function public.current_org_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select org_id from public.users where auth_id = auth.uid()
$$;

create function public.current_user_role()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select role from public.users where auth_id = auth.uid()
$$;

-- =========================================================================
-- 3. TRIGGER: alta de organización/usuario al registrarse
-- =========================================================================

create function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org_id uuid;
  v_role text;
  v_invitation public.invitations%rowtype;
  v_token_hash text;
  v_user_id uuid;
begin
  v_token_hash := new.raw_user_meta_data ->> 'invitation_token_hash';

  if v_token_hash is not null then
    -- Camino: aceptar invitación. org_id/role vienen SIEMPRE de la fila de
    -- invitación validada, nunca de metadata que el cliente pueda falsificar.
    select *
    into v_invitation
    from public.invitations
    where token_hash = v_token_hash
      and used_at is null
      and expires_at > now()
      and lower(email) = lower(new.email)
    for update;

    if not found then
      raise exception 'Invalid or expired invitation';
    end if;

    update public.invitations
    set used_at = now()
    where id = v_invitation.id;

    v_org_id := v_invitation.org_id;
    v_role := v_invitation.role;
  else
    -- Camino: signup de organización nueva. No hay org preexistente que suplantar.
    insert into public.organizations (name, slug, default_currency, locale)
    values (
      new.raw_user_meta_data ->> 'org_name',
      new.raw_user_meta_data ->> 'org_slug',
      coalesce(new.raw_user_meta_data ->> 'default_currency', 'EUR'),
      coalesce(new.raw_user_meta_data ->> 'locale', 'es')
    )
    returning id into v_org_id;

    v_role := 'org_admin';
  end if;

  insert into public.users (auth_id, org_id, email, full_name, role)
  values (
    new.id,
    v_org_id,
    new.email,
    new.raw_user_meta_data ->> 'full_name',
    v_role
  )
  returning id into v_user_id;

  if v_token_hash is not null then
    insert into public.audit_log (org_id, actor_id, action, entity, entity_id, diff)
    values (
      v_org_id, v_user_id, 'invitation.redeemed', 'invitation', v_invitation.id,
      jsonb_build_object('email', new.email, 'role', v_role)
    );
  else
    insert into public.audit_log (org_id, actor_id, action, entity, entity_id, diff)
    values (
      v_org_id, v_user_id, 'organization.created', 'organization', v_org_id,
      jsonb_build_object('name', new.raw_user_meta_data ->> 'org_name')
    );
  end if;

  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- =========================================================================
-- 4. TRIGGER: proteger org_id/role de auto-escalado (RLS no restringe columnas)
-- =========================================================================

create function public.protect_users_columns()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.org_id <> old.org_id then
    raise exception 'org_id is immutable';
  end if;

  if new.role <> old.role and public.current_user_role() <> 'org_admin' then
    raise exception 'only org_admin can change role';
  end if;

  return new;
end;
$$;

create trigger before_update_users
  before update on public.users
  for each row execute function public.protect_users_columns();

-- =========================================================================
-- 5. RPCs de invitaciones (SECURITY DEFINER — permiten auditar de forma atómica)
-- =========================================================================

create function public.create_invitation(
  p_email text,
  p_role text,
  p_token_hash text,
  p_expires_at timestamptz
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller public.users%rowtype;
  v_invitation_id uuid;
begin
  select * into v_caller from public.users where auth_id = auth.uid();

  if v_caller.role not in ('org_admin', 'it_admin') then
    raise exception 'insufficient privileges to create invitations';
  end if;

  insert into public.invitations (org_id, email, role, token_hash, invited_by, expires_at)
  values (v_caller.org_id, p_email, p_role, p_token_hash, v_caller.id, p_expires_at)
  returning id into v_invitation_id;

  insert into public.audit_log (org_id, actor_id, action, entity, entity_id, diff)
  values (
    v_caller.org_id, v_caller.id, 'invitation.created', 'invitation', v_invitation_id,
    jsonb_build_object('email', p_email, 'role', p_role)
  );

  return v_invitation_id;
end;
$$;

create function public.revoke_invitation(p_invitation_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller public.users%rowtype;
  v_invitation public.invitations%rowtype;
begin
  select * into v_caller from public.users where auth_id = auth.uid();

  if v_caller.role not in ('org_admin', 'it_admin') then
    raise exception 'insufficient privileges to revoke invitations';
  end if;

  select * into v_invitation
  from public.invitations
  where id = p_invitation_id and org_id = v_caller.org_id;

  if not found then
    raise exception 'invitation not found';
  end if;

  if v_invitation.used_at is not null then
    raise exception 'invitation already redeemed';
  end if;

  delete from public.invitations where id = p_invitation_id;

  insert into public.audit_log (org_id, actor_id, action, entity, entity_id, diff)
  values (
    v_caller.org_id, v_caller.id, 'invitation.revoked', 'invitation', p_invitation_id,
    jsonb_build_object('email', v_invitation.email, 'role', v_invitation.role)
  );
end;
$$;

-- RPC pública (sin sesión): previsualiza una invitación por su hash antes del
-- signup. El conocimiento del token es la autorización, igual que un enlace
-- de reseteo de contraseña — no expone nada que el token no revele ya.
create function public.get_invitation_preview(p_token_hash text)
returns table (org_name text, email text, role text)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  return query
    select o.name, i.email, i.role
    from public.invitations i
    join public.organizations o on o.id = i.org_id
    where i.token_hash = p_token_hash
      and i.used_at is null
      and i.expires_at > now();
end;
$$;

-- =========================================================================
-- 6. ROW LEVEL SECURITY
-- =========================================================================

alter table public.organizations enable row level security;
alter table public.users enable row level security;
alter table public.invitations enable row level security;
alter table public.audit_log enable row level security;

-- organizations: un usuario solo ve/edita la fila de su propia org; nunca inserta
-- ni borra directamente (alta vía trigger, borrado será un flujo de offboarding futuro).
create policy organizations_select on public.organizations
  for select
  using (id = public.current_org_id());

create policy organizations_update on public.organizations
  for update
  using (id = public.current_org_id() and public.current_user_role() = 'org_admin')
  with check (id = public.current_org_id() and public.current_user_role() = 'org_admin');

create policy organizations_no_insert on public.organizations
  for insert
  with check (false);

create policy organizations_no_delete on public.organizations
  for delete
  using (false);

-- users: aislamiento por org_id; alta solo vía trigger; org_admin gestiona su org.
create policy users_select on public.users
  for select
  using (org_id = public.current_org_id());

create policy users_no_insert on public.users
  for insert
  with check (false);

create policy users_update_self on public.users
  for update
  using (auth_id = auth.uid())
  with check (auth_id = auth.uid());

create policy users_update_admin on public.users
  for update
  using (org_id = public.current_org_id() and public.current_user_role() = 'org_admin')
  with check (org_id = public.current_org_id() and public.current_user_role() = 'org_admin');

create policy users_delete_admin on public.users
  for delete
  using (org_id = public.current_org_id() and public.current_user_role() = 'org_admin');

-- invitations: solo lectura directa para org_admin/it_admin de su org; toda
-- mutación pasa por create_invitation()/revoke_invitation() (SECURITY DEFINER).
create policy invitations_select on public.invitations
  for select
  using (
    org_id = public.current_org_id()
    and public.current_user_role() in ('org_admin', 'it_admin')
  );

create policy invitations_no_insert on public.invitations
  for insert
  with check (false);

create policy invitations_no_update on public.invitations
  for update
  using (false);

create policy invitations_no_delete on public.invitations
  for delete
  using (false);

-- audit_log: solo lectura para org_admin/it_admin de su org; ninguna mutación
-- directa de cliente, solo las funciones SECURITY DEFINER de arriba.
create policy audit_log_select on public.audit_log
  for select
  using (
    org_id = public.current_org_id()
    and public.current_user_role() in ('org_admin', 'it_admin')
  );

create policy audit_log_no_insert on public.audit_log
  for insert
  with check (false);

create policy audit_log_no_update on public.audit_log
  for update
  using (false);

create policy audit_log_no_delete on public.audit_log
  for delete
  using (false);
