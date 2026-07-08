-- Bloque 1.3 — ajuste a import_spend_records()
-- create_import_batch() (0007) guarda un has_header PROVISIONAL (suposición
-- por defecto true) en el momento del upload/preview. El valor real solo se
-- conoce cuando el usuario confirma el checkbox "primera fila es cabecera"
-- en el paso de mapeo — por eso import_spend_records() (llamada en el
-- commit) ahora lo recibe y sobrescribe el valor provisional con el
-- confirmado.
create or replace function public.import_spend_records(
  p_batch_id uuid,
  p_records jsonb,
  p_error_count integer default 0,
  p_has_header boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller public.users%rowtype;
  v_total integer;
  v_imported integer;
  v_duplicates integer;
begin
  select * into v_caller from public.users where auth_id = auth.uid();

  if v_caller.role not in ('finance', 'it_admin', 'org_admin') then
    raise exception 'insufficient privileges to import spend records';
  end if;

  update public.import_batches
  set status = 'processing'
  where id = p_batch_id and org_id = v_caller.org_id and status = 'uploaded';

  if not found then
    raise exception 'import batch not found or already processed';
  end if;

  v_total := coalesce(jsonb_array_length(p_records), 0);

  with inserted as (
    insert into public.spend_records (org_id, amount, currency, date, source, raw_description, import_batch_id, dedup_hash)
    select
      v_caller.org_id,
      v.amount,
      v.currency,
      v.date,
      'card_csv',
      v.raw_description,
      p_batch_id,
      md5(v.date::text || '|' || v.amount::text || '|' || v.currency || '|' || public.normalize_bank_text(v.raw_description))
    from (
      select
        (r ->> 'amount')::numeric as amount,
        upper(r ->> 'currency') as currency,
        (r ->> 'date')::date as date,
        r ->> 'raw_description' as raw_description
      from jsonb_array_elements(p_records) as r
    ) v
    on conflict (org_id, dedup_hash) do nothing
    returning id, raw_description
  ),
  queued as (
    insert into public.reconciliation_queue (org_id, spend_record_id, suggested_catalog_id, confidence, status)
    select
      v_caller.org_id,
      i.id,
      case when m.confidence >= 0.40 then m.catalog_id else null end,
      m.confidence,
      'pending'
    from inserted i
    left join lateral public.best_catalog_match(i.raw_description) m on true
    returning 1
  )
  select count(*) into v_imported from inserted;

  v_duplicates := greatest(v_total - v_imported, 0);

  update public.import_batches
  set status = 'completed',
      row_count = v_total,
      imported_count = v_imported,
      duplicate_count = v_duplicates,
      error_count = p_error_count,
      has_header = p_has_header
  where id = p_batch_id;

  insert into public.audit_log (org_id, actor_id, action, entity, entity_id, diff)
  values (
    v_caller.org_id, v_caller.id, 'import.completed', 'import_batch', p_batch_id,
    jsonb_build_object('imported', v_imported, 'duplicates', v_duplicates, 'errors', p_error_count)
  );

  return jsonb_build_object('imported', v_imported, 'duplicates', v_duplicates);
end;
$$;
