-- Bloque 3.2b — Administración de approval_rules
--
-- 3.2a solo sembraba la matriz default (sin RPC de edición, RLS
-- with check(false) en las 3 mutaciones). Este bloque añade la única forma
-- de escribir en approval_rules: dos RPCs security definer, org_admin.
--
-- Desviación deliberada de docs/TASKS.md (que pedía 3 RPCs
-- create_approval_rule/update_approval_rule/delete_approval_rule, edición
-- fila a fila) — aprobada con el usuario en modo planificación, documentada
-- en docs/DECISIONS.md: en vez de eso, save_approval_rule_scope() reemplaza
-- ATÓMICAMENTE todo el tramo de un scope (global o un departamento). Editar
-- filas sueltas hace que "sin huecos ni solapamientos" sea una validación
-- dependiente del orden de operaciones (¿qué pasa si borras el tramo 2 de 3
-- antes de ajustar el 1 y el 3?). Modelando la matriz como una partición
-- ordenada de la recta numérica (cada tramo = su max_amount, el min_amount
-- es SIEMPRE el max_amount del tramo anterior, el último tramo siempre
-- max_amount=null), la UI construye por diseño una estructura sin huecos ni
-- solapes, y la RPC solo valida la FORMA (orden ascendente, cada tramo con
-- >=1 paso, step_order 1..N contiguo, tipos de aprobador coherentes) en vez
-- de comparar contra el estado previo en la DB.
--
-- purchase_request_steps NO tiene ninguna FK hacia approval_rules (el
-- snapshot copia valores en el momento de materializar) — el borra+reinserta
-- atómico de abajo es, por tanto, estructuralmente incapaz de romper o
-- bloquear una solicitud en vuelo.

-- =========================================================================
-- 1. save_approval_rule_scope() — reemplazo atómico de un scope completo
-- =========================================================================

create function public.save_approval_rule_scope(p_department_id uuid, p_tiers jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller public.users%rowtype;
  v_tier jsonb;
  v_step jsonb;
  v_tier_count integer;
  v_tier_index integer;
  v_prev_max numeric;
  v_max_amount numeric;
  v_is_last_tier boolean;
  v_step_index integer;
  v_step_count integer;
  v_approver_type text;
  v_approver_role text;
  v_approver_user_id uuid;
begin
  select * into v_caller from public.users where auth_id = auth.uid();

  if v_caller.id is null then
    raise exception 'not authenticated';
  end if;

  if v_caller.role <> 'org_admin' then
    raise exception 'insufficient privileges to edit approval rules';
  end if;

  if p_department_id is not null and not exists (
    select 1 from public.departments where id = p_department_id and org_id = v_caller.org_id
  ) then
    raise exception 'department_id does not belong to this organization';
  end if;

  v_tier_count := jsonb_array_length(p_tiers);

  if v_tier_count is null or v_tier_count = 0 then
    raise exception 'at least one tier is required';
  end if;

  -- Pasada 1: validar TODA la forma antes de tocar la tabla (nunca confiar
  -- en que el cliente ya validó — Zod valida lo mismo en el cliente, esto
  -- es la fuente de verdad server-side).
  v_prev_max := 0;
  for v_tier_index in 0..v_tier_count - 1 loop
    v_tier := p_tiers -> v_tier_index;
    v_is_last_tier := (v_tier_index = v_tier_count - 1);

    if (v_tier ->> 'max_amount') is null then
      if not v_is_last_tier then
        raise exception 'only the last tier may have an unbounded max_amount';
      end if;
      v_max_amount := null;
    else
      v_max_amount := (v_tier ->> 'max_amount')::numeric;
      if v_max_amount <= v_prev_max then
        raise exception 'tier max_amount must be strictly increasing (tier %)', v_tier_index + 1;
      end if;
    end if;

    v_step_count := jsonb_array_length(v_tier -> 'steps');
    if v_step_count is null or v_step_count = 0 then
      raise exception 'tier % must have at least one step', v_tier_index + 1;
    end if;

    for v_step_index in 0..v_step_count - 1 loop
      v_step := (v_tier -> 'steps') -> v_step_index;
      v_approver_type := v_step ->> 'approver_type';

      if v_approver_type not in ('auto', 'manager_of_requester', 'role', 'specific_user') then
        raise exception 'invalid approver_type in tier %, step %', v_tier_index + 1, v_step_index + 1;
      end if;

      if v_approver_type = 'auto' and v_step_count > 1 then
        raise exception 'tier % has approver_type=auto but more than one step', v_tier_index + 1;
      end if;

      v_approver_role := v_step ->> 'approver_role';
      v_approver_user_id := nullif(v_step ->> 'approver_user_id', '')::uuid;

      if v_approver_type = 'role' then
        if v_approver_role is null or v_approver_user_id is not null then
          raise exception 'approver_type=role requires approver_role and no approver_user_id (tier %, step %)',
            v_tier_index + 1, v_step_index + 1;
        end if;
        if v_approver_role not in ('employee', 'manager', 'finance', 'it_admin', 'org_admin') then
          raise exception 'invalid approver_role in tier %, step %', v_tier_index + 1, v_step_index + 1;
        end if;
      elsif v_approver_type = 'specific_user' then
        if v_approver_user_id is null or v_approver_role is not null then
          raise exception 'approver_type=specific_user requires approver_user_id and no approver_role (tier %, step %)',
            v_tier_index + 1, v_step_index + 1;
        end if;
        if not exists (select 1 from public.users where id = v_approver_user_id and org_id = v_caller.org_id) then
          raise exception 'approver_user_id does not belong to this organization (tier %, step %)',
            v_tier_index + 1, v_step_index + 1;
        end if;
      else
        if v_approver_role is not null or v_approver_user_id is not null then
          raise exception 'approver_type=% must not specify approver_role/approver_user_id (tier %, step %)',
            v_approver_type, v_tier_index + 1, v_step_index + 1;
        end if;
      end if;
    end loop;

    v_prev_max := coalesce(v_max_amount, v_prev_max);
  end loop;

  -- Pasada 2: todo validado — reemplazo atómico del scope completo.
  delete from public.approval_rules
  where org_id = v_caller.org_id and department_id is not distinct from p_department_id;

  v_prev_max := 0;
  for v_tier_index in 0..v_tier_count - 1 loop
    v_tier := p_tiers -> v_tier_index;
    v_is_last_tier := (v_tier_index = v_tier_count - 1);
    v_max_amount := case when v_is_last_tier then null else (v_tier ->> 'max_amount')::numeric end;
    v_step_count := jsonb_array_length(v_tier -> 'steps');

    for v_step_index in 0..v_step_count - 1 loop
      v_step := (v_tier -> 'steps') -> v_step_index;

      insert into public.approval_rules (
        org_id, department_id, min_amount, max_amount, step_order, approver_type, approver_role, approver_user_id
      )
      values (
        v_caller.org_id, p_department_id, v_prev_max, v_max_amount, v_step_index + 1,
        v_step ->> 'approver_type',
        v_step ->> 'approver_role',
        nullif(v_step ->> 'approver_user_id', '')::uuid
      );
    end loop;

    v_prev_max := coalesce(v_max_amount, v_prev_max);
  end loop;

  insert into public.audit_log (org_id, actor_id, action, entity, entity_id, diff)
  values (
    v_caller.org_id, v_caller.id, 'approval_rules.scope_saved', 'approval_rules', p_department_id,
    jsonb_build_object('department_id', p_department_id, 'tiers', p_tiers)
  );
end;
$$;

-- =========================================================================
-- 2. restore_default_approval_rules() — global: repone el seed literal;
--    departamento: borra sus overrides (vuelve a heredar la global)
-- =========================================================================

create function public.restore_default_approval_rules(p_department_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller public.users%rowtype;
begin
  select * into v_caller from public.users where auth_id = auth.uid();

  if v_caller.id is null then
    raise exception 'not authenticated';
  end if;

  if v_caller.role <> 'org_admin' then
    raise exception 'insufficient privileges to edit approval rules';
  end if;

  if p_department_id is not null and not exists (
    select 1 from public.departments where id = p_department_id and org_id = v_caller.org_id
  ) then
    raise exception 'department_id does not belong to this organization';
  end if;

  delete from public.approval_rules
  where org_id = v_caller.org_id and department_id is not distinct from p_department_id;

  if p_department_id is null then
    -- Mismos valores literales que el seed de handle_new_user() (0023) — en
    -- la moneda default de la org, nunca EUR hardcodeado ni convertido: los
    -- umbrales de approval_rules siempre se interpretan en esa moneda
    -- porque convert_amount() ya convierte el importe de la solicitud A ella
    -- antes de comparar.
    insert into public.approval_rules (org_id, department_id, min_amount, max_amount, step_order, approver_type, approver_role)
    values
      (v_caller.org_id, null, 0, 500, 1, 'auto', null),
      (v_caller.org_id, null, 500, 5000, 1, 'manager_of_requester', null),
      (v_caller.org_id, null, 5000, null, 1, 'manager_of_requester', null),
      (v_caller.org_id, null, 5000, null, 2, 'role', 'finance');
  end if;

  insert into public.audit_log (org_id, actor_id, action, entity, entity_id, diff)
  values (
    v_caller.org_id, v_caller.id, 'approval_rules.restored_defaults', 'approval_rules', p_department_id,
    jsonb_build_object('department_id', p_department_id)
  );
end;
$$;
