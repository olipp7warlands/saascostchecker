-- Bloque 1.3 — Import de gasto (CSV)
-- Tablas: import_batches, spend_records, reconciliation_queue (multi-tenant
-- normales, org_id + RLS, mismo patrón que vendors/contracts de 0005).
-- Funciones: normalize_bank_text() (normalización compartida por dedup_hash Y
-- el fuzzy matcher — una sola implementación, nunca duplicada en JS),
-- best_catalog_match() (reutiliza pg_trgm/similarity() instalado en 0003).
-- RPCs: create_import_batch(), import_spend_records(), link_reconciliation(),
-- create_vendor_from_reconciliation(), ignore_reconciliation(),
-- bulk_accept_reconciliation(). Todas security definer, comprueban org_id +
-- role in ('finance','it_admin','org_admin') y escriben audit_log en la misma
-- transacción. RLS bloquea insert/update/delete directos: toda mutación pasa
-- por estas RPCs.

-- =========================================================================
-- 1. NORMALIZACIÓN DE TEXTO BANCARIO
-- =========================================================================

-- Una sola implementación (SQL, immutable) reutilizada tanto por dedup_hash
-- (columna generada de spend_records, más abajo) como por best_catalog_match()
-- — evita el riesgo de que una reimplementación en JS del importador diverja
-- de esta cuando se corrija un caso límite en solo una de las dos.
--
-- Pasos: 1) quita boilerplate bancario español si aparece al principio
-- (lista corta, no exhaustiva — ampliable con datos reales de clientes, ver
-- docs/DECISIONS.md); 2) mayúsculas y cualquier carácter fuera de [A-Z0-9 ]
-- (incluye *, ., /, -) pasa a espacio; 3) quita rachas de >=4 caracteres del
-- conjunto [0-9X] (números de referencia/teléfono/tarjeta enmascarada tipo
-- "4532XXXXXXXX1234" — umbral seguro porque ningún nombre/alias del catálogo
-- tiene más de 3 dígitos seguidos: "8x8", "15Five"->"15", "360Learning"->"360");
-- 4) colapsa espacios y recorta.
create function public.normalize_bank_text(p_text text)
returns text
language sql
immutable
set search_path = ''
as $$
  with upper_text as (
    select upper(coalesce(p_text, '')) as t
  ),
  stripped_prefix as (
    select regexp_replace(
      t,
      '^(COMPRA TARJETA|COMPRA EN|PAGO CON TARJETA|ADEUDO SEPA|RECIBO SEPA|RECIBO DE|' ||
      'TRANSFERENCIA A FAVOR DE|TRANSFERENCIA A|BIZUM A FAVOR DE|BIZUM DE|PAGO A)\s+',
      ''
    ) as t
    from upper_text
  ),
  alnum_only as (
    select regexp_replace(t, '[^A-Z0-9 ]', ' ', 'g') as t
    from stripped_prefix
  ),
  no_refs as (
    select regexp_replace(t, '[0-9X]{4,}', ' ', 'g') as t
    from alnum_only
  )
  select trim(regexp_replace(t, '\s+', ' ', 'g'))
  from no_refs
$$;

-- =========================================================================
-- 2. TABLAS
-- =========================================================================

create table public.import_batches (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  uploaded_by uuid references public.users (id) on delete set null,
  original_filename text not null,
  delimiter text not null,
  encoding text not null check (encoding in ('utf-8', 'latin1')),
  has_header boolean not null default true,
  -- Sin estado "failed": un fallo dentro de import_spend_records revierte
  -- toda la transacción (incluida la transición a 'processing'), así que el
  -- batch simplemente vuelve a 'uploaded' y queda listo para reintentar — no
  -- hay ningún camino de código que necesite persistir un estado de error.
  status text not null default 'uploaded' check (status in ('uploaded', 'processing', 'completed')),
  row_count integer not null default 0,
  imported_count integer not null default 0,
  duplicate_count integer not null default 0,
  error_count integer not null default 0,
  created_at timestamptz not null default now()
);

create index import_batches_org_id_idx on public.import_batches (org_id);

create table public.spend_records (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  -- Sin cascade: perder el vínculo con un vendor borrado debe ser explícito,
  -- no arrastrar el borrado del historial de gasto (mismo criterio que
  -- contracts.vendor_id en 0005).
  vendor_id uuid references public.vendors (id) on delete set null,
  amount numeric(14, 2) not null check (amount >= 0),
  currency char(3) not null,
  date date not null,
  source text not null check (source in ('card_csv', 'erp_csv', 'manual')),
  raw_description text not null,
  import_batch_id uuid references public.import_batches (id) on delete set null,
  -- Deduplicación (SPECS §4): fecha + importe + descripción normalizada,
  -- contra TODO el histórico de la org (índice único de abajo), no solo el
  -- batch actual. NO es una columna "generated always": Postgres exige que
  -- la expresión de una columna generada sea IMMUTABLE, y date::text/
  -- numeric::text dependen de settings de sesión (DateStyle) y cuentan como
  -- solo STABLE. En su lugar, import_spend_records() calcula este hash
  -- explícitamente en el propio INSERT — sigue siendo una única
  -- implementación en Postgres (normalize_bank_text), nunca reimplementada
  -- en JS, solo que no puede vivir en una columna generada.
  dedup_hash text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index spend_records_org_id_idx on public.spend_records (org_id);
create index spend_records_vendor_id_idx on public.spend_records (vendor_id);
create index spend_records_import_batch_id_idx on public.spend_records (import_batch_id);
create unique index spend_records_org_dedup_idx on public.spend_records (org_id, dedup_hash);

create table public.reconciliation_queue (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  -- SPECS §4 también prevé discovered_app_id (Fase 5, Discovery IdP). No se
  -- añade ahora: discovered_apps no existe todavía y una FK a una tabla
  -- inexistente (o una columna muerta sin FK) es sobreingeniería para este
  -- bloque. Se añadirá con un ALTER TABLE en la migración de Fase 5 — la
  -- arquitectura de la cola no cambia, solo gana una segunda fuente.
  spend_record_id uuid not null references public.spend_records (id) on delete cascade,
  suggested_catalog_id uuid references public.saas_catalog (id) on delete set null,
  confidence numeric(3, 2),
  status text not null default 'pending' check (status in ('pending', 'linked', 'ignored')),
  resolved_vendor_id uuid references public.vendors (id) on delete set null,
  resolved_by uuid references public.users (id) on delete set null,
  resolved_at timestamptz,
  created_at timestamptz not null default now()
);

create index reconciliation_queue_org_id_idx on public.reconciliation_queue (org_id);
-- Un spend_record tiene como máximo una fila de cola (1:1) — evita filas
-- duplicadas si import_spend_records se reintentara sobre el mismo registro.
create unique index reconciliation_queue_spend_record_unique_idx on public.reconciliation_queue (spend_record_id);

-- Necesario para que el "find-or-create vendor desde catálogo" de la
-- reconciliación (§4) sea atómico: sin este índice, dos reconciliaciones
-- concurrentes que resuelven al mismo catalog_id en la misma org podrían
-- crear dos vendors duplicados (visto en la revisión de este diseño).
create unique index vendors_org_catalog_id_unique_idx
  on public.vendors (org_id, catalog_id)
  where catalog_id is not null;

-- =========================================================================
-- 3. FUZZY MATCHER — best_catalog_match()
-- =========================================================================

-- Devuelve la mejor entrada de saas_catalog para una descripción bancaria
-- cruda, con su confidence (0-1). Reutiliza los índices trigram de
-- saas_catalog instalados en 0003 vía similarity(). Ver docs/DECISIONS.md
-- para la justificación completa del algoritmo (10 ejemplos trazados a mano
-- antes de implementar, incluido el caso PayPal/agregadores de pago).
create function public.best_catalog_match(p_raw_description text)
returns table (catalog_id uuid, confidence numeric)
language sql
stable
set search_path = ''
as $$
  with desc_full as (
    select public.normalize_bank_text(p_raw_description) as v
  ),
  desc_tail as (
    -- Si la descripción cruda contiene '*' (patrón de tarjeta
    -- "PROCESADOR*COMERCIO"), el segmento tras el ÚLTIMO '*' se compara
    -- también de forma aislada — así "PAYPAL *FIGMA INC" matchea Figma por
    -- el segmento "FIGMA INC" en vez de empatar/perder contra el propio
    -- PayPal (alias vacío 'PAYPAL *' del rail de pago).
    select case
      when position('*' in coalesce(p_raw_description, '')) > 0
        then public.normalize_bank_text(substring(p_raw_description from '[^*]*$'))
      else (select v from desc_full)
    end as v
  ),
  candidates as (
    select c.id as catalog_id, public.normalize_bank_text(c.name) as target
    from public.saas_catalog c
    union all
    select c.id, public.normalize_bank_text(a.alias)
    from public.saas_catalog c
    cross join lateral unnest(c.aliases) as a (alias)
    union all
    -- Alias-plantilla con placeholder (p.ej. 'SLACK T-XXXX'): además del
    -- alias literal (que nunca matcheará un ID real), se registra un
    -- candidato adicional con la cola de placeholder eliminada ("SLACK T"),
    -- usado solo para la regla de prefijo (d) — sin esto, un alias-plantilla
    -- nunca podría matchear ningún string real.
    select c.id, trim(regexp_replace(public.normalize_bank_text(a.alias), '(.)\1{2,}$', ''))
    from public.saas_catalog c
    cross join lateral unnest(c.aliases) as a (alias)
    where public.normalize_bank_text(a.alias) ~ '(.)\1{2,}$'
  ),
  scored as (
    select
      cand.catalog_id,
      greatest(
        -- (a) coincidencia exacta con la cadena completa
        case when cand.target = df.v then 1.0 else 0 end,
        -- (b) coincidencia exacta con el segmento tras el último '*'
        case when dt.v <> '' and cand.target = dt.v then 1.0 else 0 end,
        -- (c) candidato es prefijo o sufijo de la cadena completa
        case when length(cand.target) >= 4
               and (df.v like cand.target || '%' or df.v like '%' || cand.target)
             then 0.9 else 0 end,
        -- (d) candidato (posible placeholder-stripped) es prefijo del segmento cola
        case when length(cand.target) >= 4 and dt.v like cand.target || '%'
             then 0.9 else 0 end,
        -- (e) candidato contenido en cualquier posición de la cadena completa
        case when length(cand.target) >= 4 and position(cand.target in df.v) > 0
             then 0.5 + 0.4 * least(1.0, length(cand.target)::numeric / greatest(length(df.v), 1))
             else 0 end,
        -- (f) alias corto (<4 chars, p.ej. "AI"/"CC"/"GH"): solo token completo,
        -- nunca similarity() (pg_trgm es degenerado sobre 2-3 caracteres)
        case when length(cand.target) < 4
               and cand.target = any(string_to_array(df.v, ' '))
             then 0.85 else 0 end,
        -- (g) tolerancia a typos/reordenación vía trigram, solo para candidatos >=4
        -- (pg_trgm se instaló "with schema extensions" en 0003 — igual que
        -- search_saas_catalog(), similarity() se cualifica con ese schema
        -- porque esta función fija search_path='')
        case when length(cand.target) >= 4
             then extensions.similarity(df.v, cand.target)
             else 0 end
      )::numeric(3, 2) as score
    from candidates cand, desc_full df, desc_tail dt
    where cand.target <> '' and df.v <> ''
  ),
  best as (
    select s.catalog_id, max(s.score) as confidence
    from scored s
    group by s.catalog_id
    having max(s.score) > 0
  )
  select b.catalog_id, b.confidence
  from best b
  join public.saas_catalog c on c.id = b.catalog_id
  order by b.confidence desc, c.verified desc, length(c.name) asc, c.name asc
  limit 1
$$;

-- =========================================================================
-- 4. RPCs
-- =========================================================================

create function public.create_import_batch(
  p_original_filename text,
  p_delimiter text,
  p_encoding text,
  p_has_header boolean
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller public.users%rowtype;
  v_batch_id uuid;
begin
  select * into v_caller from public.users where auth_id = auth.uid();

  if v_caller.role not in ('finance', 'it_admin', 'org_admin') then
    raise exception 'insufficient privileges to import spend records';
  end if;

  insert into public.import_batches (org_id, uploaded_by, original_filename, delimiter, encoding, has_header)
  values (v_caller.org_id, v_caller.id, p_original_filename, p_delimiter, p_encoding, p_has_header)
  returning id into v_batch_id;

  insert into public.audit_log (org_id, actor_id, action, entity, entity_id, diff)
  values (
    v_caller.org_id, v_caller.id, 'import.created', 'import_batch', v_batch_id,
    jsonb_build_object('original_filename', p_original_filename)
  );

  return v_batch_id;
end;
$$;

-- p_records: jsonb array de {date, amount, currency, raw_description}, ya
-- validados con Zod en el server action antes de llamar a esta RPC.
-- p_error_count: filas que fallaron la validación de Zod ANTES de llegar
-- aquí (nunca entran en p_records) — se registra tal cual para el resumen
-- del batch.
create function public.import_spend_records(
  p_batch_id uuid,
  p_records jsonb,
  p_error_count integer default 0
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

  -- Transición atómica uploaded -> processing: si esta fila no se actualiza
  -- (porque el batch no existe, no es de esta org, o ya se procesó) es un
  -- doble-commit (doble clic/retry) y se rechaza en vez de reprocesar.
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
      error_count = p_error_count
  where id = p_batch_id;

  insert into public.audit_log (org_id, actor_id, action, entity, entity_id, diff)
  values (
    v_caller.org_id, v_caller.id, 'import.completed', 'import_batch', p_batch_id,
    jsonb_build_object('imported', v_imported, 'duplicates', v_duplicates, 'errors', p_error_count)
  );

  return jsonb_build_object('imported', v_imported, 'duplicates', v_duplicates);
end;
$$;

-- Vincula una fila de la cola a un vendor. Exactamente uno de p_vendor_id
-- (vendor ya existente en la org) / p_catalog_id (sugerencia del catálogo
-- global) debe venir. suggested_catalog_id apunta al catálogo GLOBAL, pero
-- spend_records.vendor_id necesita un vendor de la ORG — si aún no existe un
-- vendor para ese catalog_id en esta org, se crea aquí ("find-or-create"),
-- de forma atómica vía el índice único de §2 (ON CONFLICT ... DO NOTHING +
-- re-select), a prueba de dos reconciliaciones concurrentes al mismo
-- catalog_id.
create function public.link_reconciliation(
  p_queue_id uuid,
  p_vendor_id uuid,
  p_catalog_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller public.users%rowtype;
  v_queue public.reconciliation_queue%rowtype;
  v_vendor_id uuid;
  v_catalog public.saas_catalog%rowtype;
begin
  select * into v_caller from public.users where auth_id = auth.uid();

  if v_caller.role not in ('finance', 'it_admin', 'org_admin') then
    raise exception 'insufficient privileges to resolve reconciliation queue';
  end if;

  if (p_vendor_id is null) = (p_catalog_id is null) then
    raise exception 'exactly one of vendor_id or catalog_id must be provided';
  end if;

  select * into v_queue
  from public.reconciliation_queue
  where id = p_queue_id and org_id = v_caller.org_id and status = 'pending';

  if not found then
    raise exception 'reconciliation queue entry not found or already resolved';
  end if;

  if p_vendor_id is not null then
    if not exists (select 1 from public.vendors where id = p_vendor_id and org_id = v_caller.org_id) then
      raise exception 'vendor not found';
    end if;
    v_vendor_id := p_vendor_id;
  else
    select * into v_catalog from public.saas_catalog where id = p_catalog_id;
    if not found then
      raise exception 'catalog entry not found';
    end if;

    select id into v_vendor_id
    from public.vendors
    where org_id = v_caller.org_id and catalog_id = p_catalog_id;

    if not found then
      insert into public.vendors (org_id, catalog_id, name, website, category, is_custom)
      values (v_caller.org_id, p_catalog_id, v_catalog.name, v_catalog.website, v_catalog.category, false)
      on conflict (org_id, catalog_id) where catalog_id is not null do nothing
      returning id into v_vendor_id;

      if v_vendor_id is not null then
        insert into public.audit_log (org_id, actor_id, action, entity, entity_id, diff)
        values (
          v_caller.org_id, v_caller.id, 'vendor.created', 'vendor', v_vendor_id,
          jsonb_build_object('name', v_catalog.name, 'is_custom', false, 'catalog_id', p_catalog_id, 'source', 'reconciliation')
        );
      else
        -- Carrera perdida: otra transacción concurrente ya insertó el vendor
        -- para este catalog_id entre nuestro SELECT y este INSERT. Se
        -- recupera su id en vez de duplicar.
        select id into v_vendor_id
        from public.vendors
        where org_id = v_caller.org_id and catalog_id = p_catalog_id;
      end if;
    end if;
  end if;

  update public.spend_records set vendor_id = v_vendor_id, updated_at = now()
  where id = v_queue.spend_record_id;

  update public.reconciliation_queue
  set status = 'linked', resolved_vendor_id = v_vendor_id, resolved_by = v_caller.id, resolved_at = now()
  where id = p_queue_id;

  insert into public.audit_log (org_id, actor_id, action, entity, entity_id, diff)
  values (
    v_caller.org_id, v_caller.id, 'reconciliation.linked', 'reconciliation_queue', p_queue_id,
    jsonb_build_object('vendor_id', v_vendor_id, 'spend_record_id', v_queue.spend_record_id)
  );

  return v_vendor_id;
end;
$$;

create function public.create_vendor_from_reconciliation(
  p_queue_id uuid,
  p_vendor_name text,
  p_website text,
  p_category text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller public.users%rowtype;
  v_queue public.reconciliation_queue%rowtype;
  v_vendor_id uuid;
begin
  select * into v_caller from public.users where auth_id = auth.uid();

  if v_caller.role not in ('finance', 'it_admin', 'org_admin') then
    raise exception 'insufficient privileges to create vendors';
  end if;

  select * into v_queue
  from public.reconciliation_queue
  where id = p_queue_id and org_id = v_caller.org_id and status = 'pending';

  if not found then
    raise exception 'reconciliation queue entry not found or already resolved';
  end if;

  insert into public.vendors (org_id, catalog_id, name, website, category, is_custom)
  values (v_caller.org_id, null, p_vendor_name, p_website, p_category, true)
  returning id into v_vendor_id;

  insert into public.audit_log (org_id, actor_id, action, entity, entity_id, diff)
  values (
    v_caller.org_id, v_caller.id, 'vendor.created', 'vendor', v_vendor_id,
    jsonb_build_object('name', p_vendor_name, 'is_custom', true, 'catalog_id', null, 'source', 'reconciliation')
  );

  update public.spend_records set vendor_id = v_vendor_id, updated_at = now()
  where id = v_queue.spend_record_id;

  update public.reconciliation_queue
  set status = 'linked', resolved_vendor_id = v_vendor_id, resolved_by = v_caller.id, resolved_at = now()
  where id = p_queue_id;

  insert into public.audit_log (org_id, actor_id, action, entity, entity_id, diff)
  values (
    v_caller.org_id, v_caller.id, 'reconciliation.linked', 'reconciliation_queue', p_queue_id,
    jsonb_build_object('vendor_id', v_vendor_id, 'spend_record_id', v_queue.spend_record_id)
  );

  return v_vendor_id;
end;
$$;

create function public.ignore_reconciliation(p_queue_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller public.users%rowtype;
  v_queue public.reconciliation_queue%rowtype;
begin
  select * into v_caller from public.users where auth_id = auth.uid();

  if v_caller.role not in ('finance', 'it_admin', 'org_admin') then
    raise exception 'insufficient privileges to resolve reconciliation queue';
  end if;

  select * into v_queue
  from public.reconciliation_queue
  where id = p_queue_id and org_id = v_caller.org_id and status = 'pending';

  if not found then
    raise exception 'reconciliation queue entry not found or already resolved';
  end if;

  update public.reconciliation_queue
  set status = 'ignored', resolved_by = v_caller.id, resolved_at = now()
  where id = p_queue_id;

  insert into public.audit_log (org_id, actor_id, action, entity, entity_id, diff)
  values (
    v_caller.org_id, v_caller.id, 'reconciliation.ignored', 'reconciliation_queue', p_queue_id,
    jsonb_build_object('spend_record_id', v_queue.spend_record_id)
  );
end;
$$;

-- Vincula en bloque las sugerencias de alta confianza (>=0.65) de una
-- selección de la cola. Re-comprueba confidence/status EN EL SERVIDOR (no
-- confía en que el cliente ya filtró) — CLAUDE.md regla 5, "la UI solo
-- oculta": cualquier caller autenticado con rol válido puede invocar esta
-- RPC directamente sin pasar por la UI. Reutiliza link_reconciliation() en
-- vez de duplicar su lógica.
create function public.bulk_accept_reconciliation(p_queue_ids uuid[])
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller public.users%rowtype;
  v_id uuid;
  v_row public.reconciliation_queue%rowtype;
  v_linked integer := 0;
  v_skipped integer := 0;
begin
  select * into v_caller from public.users where auth_id = auth.uid();

  if v_caller.role not in ('finance', 'it_admin', 'org_admin') then
    raise exception 'insufficient privileges to resolve reconciliation queue';
  end if;

  foreach v_id in array coalesce(p_queue_ids, array[]::uuid[])
  loop
    select * into v_row
    from public.reconciliation_queue
    where id = v_id and org_id = v_caller.org_id;

    if not found
       or v_row.status <> 'pending'
       or v_row.suggested_catalog_id is null
       or v_row.confidence is null
       or v_row.confidence < 0.65 then
      v_skipped := v_skipped + 1;
      continue;
    end if;

    perform public.link_reconciliation(v_id, null, v_row.suggested_catalog_id);
    v_linked := v_linked + 1;
  end loop;

  return jsonb_build_object('linked', v_linked, 'skipped', v_skipped);
end;
$$;

-- =========================================================================
-- 5. ROW LEVEL SECURITY
-- =========================================================================

alter table public.import_batches enable row level security;
alter table public.spend_records enable row level security;
alter table public.reconciliation_queue enable row level security;

create policy import_batches_select on public.import_batches
  for select
  using (org_id = public.current_org_id() and public.current_user_role() in ('finance', 'it_admin', 'org_admin'));
create policy import_batches_no_insert on public.import_batches for insert with check (false);
create policy import_batches_no_update on public.import_batches for update using (false);
create policy import_batches_no_delete on public.import_batches for delete using (false);

create policy spend_records_select on public.spend_records
  for select
  using (org_id = public.current_org_id() and public.current_user_role() in ('finance', 'it_admin', 'org_admin'));
create policy spend_records_no_insert on public.spend_records for insert with check (false);
create policy spend_records_no_update on public.spend_records for update using (false);
create policy spend_records_no_delete on public.spend_records for delete using (false);

create policy reconciliation_queue_select on public.reconciliation_queue
  for select
  using (org_id = public.current_org_id() and public.current_user_role() in ('finance', 'it_admin', 'org_admin'));
create policy reconciliation_queue_no_insert on public.reconciliation_queue for insert with check (false);
create policy reconciliation_queue_no_update on public.reconciliation_queue for update using (false);
create policy reconciliation_queue_no_delete on public.reconciliation_queue for delete using (false);
