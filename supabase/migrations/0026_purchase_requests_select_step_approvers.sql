-- Bug real encontrado en verificación visual autenticada (3.2a): la RLS de
-- `purchase_requests_select` heredada de 3.1b solo permite ver una solicitud
-- al propio solicitante o a finance/org_admin de la org — nunca se amplió
-- para el motor multi-paso, así que un manager (o cualquier rol no
-- finance/org_admin) que SÍ es el aprobador real de un paso activo no podía
-- abrir /requests/[id] (404), aunque resolve_purchase_request() sí le
-- autorizara a decidir vía RPC. Mismo idioma de ensanche que 0022
-- (drop policy + create policy).
drop policy purchase_requests_select on public.purchase_requests;

create policy purchase_requests_select on public.purchase_requests
  for select
  using (
    org_id = public.current_org_id()
    and (
      requester_id = public.current_user_id()
      or public.current_user_role() in ('finance', 'org_admin')
      or exists (
        select 1
        from public.purchase_request_steps s
        where s.request_id = purchase_requests.id
          and (
            s.resolved_approver_id = public.current_user_id()
            or (s.approver_role is not null and public.current_user_role() = s.approver_role)
          )
      )
    )
  );
