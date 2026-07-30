-- Fix real de 0023: pgcrypto vive en el esquema `extensions` en este
-- proyecto (confirmado en 0024, diagnóstico no destructivo) — las funciones
-- `mint_approval_link_token()`/`resolve_purchase_request_via_link()` usan
-- `set search_path = ''` (mismo hardening que el resto del repo) y llamaban
-- a `gen_random_bytes()`/`digest()` sin calificar, lo que falla en remoto
-- ("function gen_random_bytes(integer) does not exist"). Recreadas con
-- `extensions.gen_random_bytes`/`extensions.digest`.

create or replace function public.mint_approval_link_token(p_org_id uuid, p_request_id uuid, p_step_order integer)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_secret text;
  v_secret_hash text;
  v_token_id uuid;
begin
  v_secret := encode(extensions.gen_random_bytes(32), 'hex');
  v_secret_hash := encode(extensions.digest(v_secret, 'sha256'), 'hex');

  insert into public.approval_link_tokens (org_id, request_id, step_order, secret_hash, expires_at)
  values (p_org_id, p_request_id, p_step_order, v_secret_hash, now() + interval '72 hours')
  returning id into v_token_id;

  return v_token_id::text || '_' || v_secret;
end;
$$;

create or replace function public.resolve_purchase_request_via_link(
  p_token_id uuid,
  p_secret text,
  p_decision text,
  p_comment text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_token public.approval_link_tokens%rowtype;
  v_step public.purchase_request_steps%rowtype;
begin
  if p_decision not in ('approved', 'rejected') then
    raise exception 'p_decision must be approved or rejected';
  end if;

  select * into v_token from public.approval_link_tokens where id = p_token_id for update;

  if v_token.id is null
     or v_token.used_at is not null
     or v_token.revoked_at is not null
     or v_token.expires_at <= now()
     or encode(extensions.digest(p_secret, 'sha256'), 'hex') <> v_token.secret_hash then
    raise exception 'invalid_or_expired_token';
  end if;

  select * into v_step
  from public.purchase_request_steps
  where request_id = v_token.request_id and step_order = v_token.step_order
    and status in ('pending', 'escalated_to_org_admin')
  for update;

  if v_step.id is null then
    raise exception 'invalid_or_expired_token';
  end if;

  if p_decision = 'rejected' and (p_comment is null or length(trim(p_comment)) = 0) then
    raise exception 'rejection_reason is required when rejecting';
  end if;

  update public.approval_link_tokens set used_at = now() where id = p_token_id;

  perform public.advance_purchase_request_step(
    v_token.request_id, v_step.step_order, p_decision, p_comment, 'link', v_step.resolved_approver_id
  );
end;
$$;
