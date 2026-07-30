-- Fix real de 0026: la política purchase_requests_select recién ensanchada
-- referenciaba `purchase_request_steps` inline, y la política de
-- `purchase_request_steps_select` (0023) referencia `purchase_requests`
-- inline a su vez — un ciclo que Postgres detecta como "infinite recursion
-- detected in policy for relation purchase_requests" en cuanto alguien sin
-- rol finance/org_admin intenta leer cualquiera de las dos tablas.
--
-- Mismo truco que ya usan current_org_id()/current_user_role()/
-- current_user_id(): una función SECURITY DEFINER, propiedad del mismo rol
-- que las tablas (postgres), consulta purchase_request_steps directamente
-- — los dueños de tabla no están sujetos a la RLS de su propia tabla salvo
-- FORCE ROW LEVEL SECURITY (que no se usa aquí), así que la consulta
-- interna de la función NUNCA vuelve a evaluar purchase_request_steps_select
-- y el ciclo se rompe ahí, aunque el resto de la cadena siga evaluándose
-- bajo el contexto del llamador.
create function public.is_purchase_request_step_approver(p_request_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.purchase_request_steps s
    where s.request_id = p_request_id
      and (
        s.resolved_approver_id = public.current_user_id()
        or (s.approver_role is not null and public.current_user_role() = s.approver_role)
      )
  );
$$;

drop policy purchase_requests_select on public.purchase_requests;

create policy purchase_requests_select on public.purchase_requests
  for select
  using (
    org_id = public.current_org_id()
    and (
      requester_id = public.current_user_id()
      or public.current_user_role() in ('finance', 'org_admin')
      or public.is_purchase_request_step_approver(id)
    )
  );
