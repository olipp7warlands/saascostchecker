-- Bloque nuevo (junto a 0019_budgets.sql, ver docs/DECISIONS.md): tags por
-- vendor. Sin taxonomía predefinida ni tabla de catálogo separada — el
-- autocompletado de "tags existentes de la org" es un simple
-- `select distinct tag`, y ya deja los tags consultables por
-- agrupación/solapamiento para el futuro motor de ahorros sin refactor.
--
-- RPCs: add_vendor_tag()/remove_vendor_tag() — mismo esqueleto que las RPCs
-- de vendors (0005_vendors_contracts.sql): MANAGER_ROLES
-- (finance/it_admin/org_admin), audit_log en la misma transacción.

create table public.vendor_tags (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  vendor_id uuid not null references public.vendors (id) on delete cascade,
  -- Normalizado en la RPC (lower+trim), nunca confiando en que el cliente ya
  -- lo mandó normalizado — el check es una segunda barrera, no la única.
  tag text not null check (tag = lower(btrim(tag)) and tag <> ''),
  created_at timestamptz not null default now(),
  unique (vendor_id, tag)
);

create index vendor_tags_org_id_idx on public.vendor_tags (org_id);
create index vendor_tags_vendor_id_idx on public.vendor_tags (vendor_id);
-- Soporta tanto "tags de un vendor" (ya cubierto por el unique de arriba)
-- como "vendors que tienen el tag X" (agrupación/solapamiento del futuro
-- motor de ahorros) sin necesidad de un índice de expresión adicional.
create index vendor_tags_tag_idx on public.vendor_tags (org_id, tag);

create function public.add_vendor_tag(p_vendor_id uuid, p_tag text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller public.users%rowtype;
  v_tag text := lower(btrim(p_tag));
begin
  select * into v_caller from public.users where auth_id = auth.uid();

  if v_caller.role not in ('finance', 'it_admin', 'org_admin') then
    raise exception 'insufficient privileges to tag vendors';
  end if;

  if v_tag = '' then
    raise exception 'tag must not be empty';
  end if;

  if not exists (
    select 1 from public.vendors where id = p_vendor_id and org_id = v_caller.org_id
  ) then
    raise exception 'vendor not found';
  end if;

  insert into public.vendor_tags (org_id, vendor_id, tag)
  values (v_caller.org_id, p_vendor_id, v_tag)
  on conflict (vendor_id, tag) do nothing;

  insert into public.audit_log (org_id, actor_id, action, entity, entity_id, diff)
  values (
    v_caller.org_id, v_caller.id, 'vendor.tag_added', 'vendor', p_vendor_id,
    jsonb_build_object('tag', v_tag)
  );
end;
$$;

create function public.remove_vendor_tag(p_vendor_id uuid, p_tag text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller public.users%rowtype;
  v_tag text := lower(btrim(p_tag));
begin
  select * into v_caller from public.users where auth_id = auth.uid();

  if v_caller.role not in ('finance', 'it_admin', 'org_admin') then
    raise exception 'insufficient privileges to tag vendors';
  end if;

  if not exists (
    select 1 from public.vendors where id = p_vendor_id and org_id = v_caller.org_id
  ) then
    raise exception 'vendor not found';
  end if;

  delete from public.vendor_tags
  where vendor_id = p_vendor_id and org_id = v_caller.org_id and tag = v_tag;

  insert into public.audit_log (org_id, actor_id, action, entity, entity_id, diff)
  values (
    v_caller.org_id, v_caller.id, 'vendor.tag_removed', 'vendor', p_vendor_id,
    jsonb_build_object('tag', v_tag)
  );
end;
$$;

alter table public.vendor_tags enable row level security;

create policy vendor_tags_select on public.vendor_tags
  for select
  using (org_id = public.current_org_id() and public.current_user_role() in ('finance', 'it_admin', 'org_admin'));

create policy vendor_tags_no_insert on public.vendor_tags
  for insert
  with check (false);

create policy vendor_tags_no_update on public.vendor_tags
  for update
  using (false);

create policy vendor_tags_no_delete on public.vendor_tags
  for delete
  using (false);
