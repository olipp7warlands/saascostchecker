-- Bloque 1.1 — Catálogo global de SaaS
-- Tabla: saas_catalog (global, SIN org_id — única excepción a la regla de
-- multi-tenancy de CLAUDE.md; ver docs/SPECS.md §3-4).
-- RPC: search_saas_catalog() — ranking prefijo > contains, name > alias.

-- =========================================================================
-- 1. EXTENSIÓN
-- =========================================================================

-- pg_trgm: acelera búsquedas "contains"/fuzzy sobre name y aliases (índices
-- GIN más abajo) y es la base que reutilizará el fuzzy matcher del bloque
-- 1.3 (similarity()) contra descripciones de banco ruidosas.
create extension if not exists pg_trgm with schema extensions;

-- =========================================================================
-- 2. TABLA
-- =========================================================================

create table public.saas_catalog (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  aliases text[] not null default '{}',
  category text not null check (category in (
    'crm', 'marketing', 'sales', 'design', 'productivity', 'communication',
    'devtools', 'observability', 'security', 'analytics', 'hr', 'finance',
    'support', 'project_management', 'video', 'other'
  )),
  -- Dominio pelado (p.ej. "figma.com"), no una URL completa: es literalmente
  -- lo que <AppLogo domain/> necesita para el favicon, sin parseo en cada
  -- consumidor. "Logos no se almacenan" (SPECS §7 1.1): logo_url queda para
  -- una futura curación manual, el fallback por defecto siempre es el favicon
  -- derivado de website.
  website text not null,
  logo_url text,
  verified boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Evita duplicados de datos (mismo software sembrado dos veces con distinta
-- capitalización).
create unique index saas_catalog_name_unique_idx on public.saas_catalog (lower(name));

-- array_to_string() está marcado STABLE (no IMMUTABLE) en el catálogo de
-- Postgres para cualquier anyarray, aunque para text[] el resultado es en la
-- práctica determinista. Un índice de expresión exige IMMUTABLE, así que se
-- envuelve en esta función — el workaround estándar para este caso. La usan
-- tanto el índice de abajo como search_saas_catalog(), con la MISMA
-- expresión exacta, para que el planner pueda casar una contra la otra.
create function public.saas_alias_blob(text[])
returns text
language sql
immutable
set search_path = ''
as $$
  select array_to_string($1, ' ')
$$;

-- =========================================================================
-- 3. ÍNDICES DE BÚSQUEDA (name + aliases)
-- =========================================================================

-- Prefijo en name ("figm" -> "Figma…"): btree con text_pattern_ops permite un
-- escaneo de rango para `LIKE 'prefijo%'`, el caso más común del autocompletado.
create index saas_catalog_name_prefix_idx
  on public.saas_catalog (lower(name) text_pattern_ops);

-- Contains en name ("gma" dentro de "Figma"): GIN trigram acelera `LIKE '%x%'`.
create index saas_catalog_name_trgm_idx
  on public.saas_catalog using gin (lower(name) extensions.gin_trgm_ops);

-- aliases es text[]; un GIN sobre el array por defecto solo acelera `@>`/`&&`
-- (contención exacta de elementos), no "¿algún elemento contiene X?". Como la
-- búsqueda solo necesita saber SI algún alias matchea (no cuál), se concatena
-- el array en un solo texto (saas_alias_blob) y se indexa igual que name.
-- Coste teórico: un falso positivo si la query cae justo en el límite entre
-- dos alias distintos (p.ej. aliases ["Google Docs","Sheets"] y query
-- "docssheets") — irrelevante para queries reales cortas tipo "figm"/"loom".
create index saas_catalog_aliases_trgm_idx
  on public.saas_catalog using gin (lower(public.saas_alias_blob(aliases)) extensions.gin_trgm_ops);

-- =========================================================================
-- 4. ROW LEVEL SECURITY
-- =========================================================================

alter table public.saas_catalog enable row level security;

-- Lectura pública dentro de la app: cualquier usuario autenticado, de
-- cualquier org (es la única tabla sin aislamiento por org_id). anon no lee.
create policy saas_catalog_select on public.saas_catalog
  for select
  to authenticated
  using (true);

-- Ningún cliente escribe nunca: el seed entra por migración (0004), altas
-- futuras (p.ej. promover un vendor custom al catálogo) serán una RPC
-- security definer cuando exista ese flujo — fuera de alcance de 1.1.
create policy saas_catalog_no_insert on public.saas_catalog
  for insert
  with check (false);

create policy saas_catalog_no_update on public.saas_catalog
  for update
  using (false);

create policy saas_catalog_no_delete on public.saas_catalog
  for delete
  using (false);

-- =========================================================================
-- 5. BÚSQUEDA: search_saas_catalog()
-- =========================================================================

-- SECURITY INVOKER (por defecto, sin declarar security definer): no hay
-- dependencia circular como con current_org_id()/current_user_role(), así
-- que la propia RLS de saas_catalog ya protege esta función igual que
-- protegería una query directa a la tabla.
--
-- El WHERE usa predicados LIKE directos (no un CASE que oculte los
-- predicados) para que el planner pueda usar los índices de arriba vía
-- BitmapOr entre las 3 ramas del OR. El ranking ("prefijo > contains,
-- name > alias") vive solo en el ORDER BY:
--   0 = prefijo en name       (el eje prefijo/contains pesa más que el eje
--   1 = prefijo en alias       name/alias, así que un alias-prefijo (1) le
--   2 = contains en name       gana a un name-contains (2))
--   3 = contains en alias
create function public.search_saas_catalog(p_query text, p_limit integer default 8)
returns table (
  id uuid,
  name text,
  aliases text[],
  category text,
  website text,
  logo_url text,
  verified boolean
)
language sql
stable
set search_path = ''
as $$
  with q as (
    -- Escapa % / _ / \ literales que el usuario haya tecleado — si no, un
    -- usuario buscando "50%" vería LIKE interpretarlo como comodín.
    select replace(replace(replace(lower(trim(p_query)), '\', '\\'), '%', '\%'), '_', '\_') as term
  ),
  candidates as (
    select
      c.id, c.name, c.aliases, c.category, c.website, c.logo_url, c.verified,
      lower(c.name) as name_lc,
      lower(public.saas_alias_blob(c.aliases)) as aliases_lc
    from public.saas_catalog c, q
    where q.term <> ''
      and (
        lower(c.name) like q.term || '%' escape '\'
        or lower(c.name) like '%' || q.term || '%' escape '\'
        or lower(public.saas_alias_blob(c.aliases)) like '%' || q.term || '%' escape '\'
      )
  )
  select id, name, aliases, category, website, logo_url, verified
  from candidates, q
  order by
    case
      when name_lc like q.term || '%' escape '\' then 0
      when aliases_lc like q.term || '%' escape '\' then 1
      when name_lc like '%' || q.term || '%' escape '\' then 2
      else 3
    end,
    length(name) asc,
    name asc
  limit greatest(p_limit, 0)
$$;
