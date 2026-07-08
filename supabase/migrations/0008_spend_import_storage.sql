-- Bloque 1.3 — Bucket de Storage para los CSV de gasto importados
-- Mismo diseño que 0006_contracts_storage.sql: bucket PRIVADO, ruta
-- {org_id}/{batch_id}/{filename} (aislamiento por tenant vía
-- (storage.foldername(name))[1] = current_org_id()::text), sin URL pública
-- persistente. El fichero se sube en previewCsvImport() y se vuelve a
-- descargar en commitCsvImport() para el parseo completo server-side (no se
-- confía en lo que el cliente dice haber parseado en el preview).

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'spend-imports', 'spend-imports', false, 10485760,
  array['text/csv', 'application/vnd.ms-excel', 'text/plain']
)
on conflict (id) do nothing;

create policy spend_imports_documents_select on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'spend-imports'
    and (storage.foldername(name))[1] = public.current_org_id()::text
    and public.current_user_role() in ('finance', 'it_admin', 'org_admin')
  );

create policy spend_imports_documents_insert on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'spend-imports'
    and (storage.foldername(name))[1] = public.current_org_id()::text
    and public.current_user_role() in ('finance', 'it_admin', 'org_admin')
  );

create policy spend_imports_documents_update on storage.objects
  for update
  to authenticated
  using (
    bucket_id = 'spend-imports'
    and (storage.foldername(name))[1] = public.current_org_id()::text
    and public.current_user_role() in ('finance', 'it_admin', 'org_admin')
  )
  with check (
    bucket_id = 'spend-imports'
    and (storage.foldername(name))[1] = public.current_org_id()::text
    and public.current_user_role() in ('finance', 'it_admin', 'org_admin')
  );

create policy spend_imports_documents_delete on storage.objects
  for delete
  to authenticated
  using (
    bucket_id = 'spend-imports'
    and (storage.foldername(name))[1] = public.current_org_id()::text
    and public.current_user_role() in ('finance', 'it_admin', 'org_admin')
  );
