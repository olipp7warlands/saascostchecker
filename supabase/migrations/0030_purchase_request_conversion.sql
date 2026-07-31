-- Bloque 3.3 — Cierre del ciclo: conversión de solicitud aprobada en vendor/contrato
--
-- Diseño aprobado con el usuario (ver docs/DECISIONS.md):
--   - La solicitud NO cambia de estado al convertirse (se queda 'approved');
--     el vínculo persistido es la única señal de "ya materializada".
--   - Reutiliza create_vendor()/create_contract() tal cual (0005/0013) — esta
--     migración solo añade el ENLACE, nunca una vía paralela de creación.
--   - Sin transacciones distribuidas entre la creación (2 RPCs ya separados,
--     patrón establecido desde 1.2) y el enlace (esta RPC nueva): si el
--     vendor/contrato se crean pero el enlace falla, ambos quedan creados y
--     la solicitud sigue ofreciendo "convertir" — enlazable a posteriori vía
--     el camino de "vendor existente" (ver record_purchase_request_conversion
--     más abajo, que puede llamarse de forma aislada con vendor/contract ya
--     existentes).
--
-- Contenido:
--   1. purchase_requests: converted_vendor_id/converted_contract_id (enlace).
--   2. contracts: source_request_id (enlace inverso — "origen: solicitud #X").
--   3. RPC record_purchase_request_conversion() — guarda anti-doble-conversión
--      + escritura atómica del vínculo en ambas tablas + audit_log.

-- =========================================================================
-- 1 y 2. Columnas de enlace
-- =========================================================================

alter table public.purchase_requests
  add column converted_vendor_id uuid references public.vendors (id) on delete set null,
  add column converted_contract_id uuid references public.contracts (id) on delete set null;

alter table public.contracts
  add column source_request_id uuid references public.purchase_requests (id) on delete set null;

-- =========================================================================
-- 3. RPC: record_purchase_request_conversion()
-- =========================================================================
-- Solo enlaza — nunca crea vendor/contrato (eso ya lo hicieron create_vendor()/
-- create_contract() antes de llamar aquí). Mismo idioma que el resto del
-- motor de aprobaciones: security definer, chequeo de rol, fila `for update`,
-- audit_log en la misma transacción.

create function public.record_purchase_request_conversion(
  p_request_id uuid,
  p_vendor_id uuid,
  p_contract_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller public.users%rowtype;
  v_request public.purchase_requests%rowtype;
  v_contract public.contracts%rowtype;
begin
  select * into v_caller from public.users where auth_id = auth.uid();

  if v_caller.id is null then
    raise exception 'not authenticated';
  end if;

  if v_caller.role not in ('finance', 'it_admin', 'org_admin') then
    raise exception 'insufficient privileges to convert purchase requests';
  end if;

  select * into v_request
  from public.purchase_requests
  where id = p_request_id and org_id = v_caller.org_id
  for update;

  if v_request.id is null then
    raise exception 'purchase request not found';
  end if;

  if v_request.status <> 'approved' then
    raise exception 'purchase request is not approved';
  end if;

  -- Guarda anti-doble-conversión: una solicitud solo se convierte una vez.
  if v_request.converted_contract_id is not null then
    raise exception 'purchase_request_already_converted';
  end if;

  if not exists (
    select 1 from public.vendors where id = p_vendor_id and org_id = v_caller.org_id
  ) then
    raise exception 'vendor not found';
  end if;

  select * into v_contract
  from public.contracts
  where id = p_contract_id and org_id = v_caller.org_id;

  if v_contract.id is null then
    raise exception 'contract not found';
  end if;

  if v_contract.vendor_id <> p_vendor_id then
    raise exception 'contract does not belong to the given vendor';
  end if;

  update public.purchase_requests
  set converted_vendor_id = p_vendor_id,
      converted_contract_id = p_contract_id,
      updated_at = now()
  where id = p_request_id;

  update public.contracts
  set source_request_id = p_request_id
  where id = p_contract_id;

  insert into public.audit_log (org_id, actor_id, action, entity, entity_id, diff)
  values (
    v_caller.org_id, v_caller.id, 'purchase_request.converted', 'purchase_request', p_request_id,
    jsonb_build_object('vendor_id', p_vendor_id, 'contract_id', p_contract_id)
  );
end;
$$;
