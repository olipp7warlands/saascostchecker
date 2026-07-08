-- Bloque 1.2 — Bucket de Storage para PDFs de contrato
-- Diseño (documentado en docs/DECISIONS.md antes de escribir esta migración):
--   - Bucket `contracts`, PRIVADO (public = false). Nunca una URL pública
--     persistente — la UI pide una signed URL al vuelo para ver/descargar.
--   - Límite de 10MB y solo application/pdf, forzado por Storage en el propio
--     upload (antes incluso de evaluar RLS).
--   - Ruta: {org_id}/{contract_id}/{filename} — el primer segmento es org_id
--     a propósito: las políticas de storage.objects aíslan por tenant leyendo
--     (storage.foldername(name))[1], el patrón que la documentación de
--     Supabase recomienda para storage multi-tenant. Un cliente no puede
--     subir/leer fuera de su propio org_id aunque construya la ruta a mano —
--     RLS lo rechaza en el servidor, no es una convención de confianza del
--     cliente.
--   - No se valida que el segundo segmento sea un contract_id real de esa
--     org: acoplaría estas políticas a la tabla contracts para una garantía
--     que no es de seguridad (el aislamiento por org_id ya cubre eso), solo
--     de "orden" — el único flujo real de la app siempre construye esa ruta
--     después de crear el contrato vía create_contract().

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('contracts', 'contracts', false, 10485760, array['application/pdf'])
on conflict (id) do nothing;

create policy contracts_documents_select on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'contracts'
    and (storage.foldername(name))[1] = public.current_org_id()::text
    and public.current_user_role() in ('finance', 'it_admin', 'org_admin')
  );

create policy contracts_documents_insert on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'contracts'
    and (storage.foldername(name))[1] = public.current_org_id()::text
    and public.current_user_role() in ('finance', 'it_admin', 'org_admin')
  );

create policy contracts_documents_update on storage.objects
  for update
  to authenticated
  using (
    bucket_id = 'contracts'
    and (storage.foldername(name))[1] = public.current_org_id()::text
    and public.current_user_role() in ('finance', 'it_admin', 'org_admin')
  )
  with check (
    bucket_id = 'contracts'
    and (storage.foldername(name))[1] = public.current_org_id()::text
    and public.current_user_role() in ('finance', 'it_admin', 'org_admin')
  );

create policy contracts_documents_delete on storage.objects
  for delete
  to authenticated
  using (
    bucket_id = 'contracts'
    and (storage.foldername(name))[1] = public.current_org_id()::text
    and public.current_user_role() in ('finance', 'it_admin', 'org_admin')
  );
