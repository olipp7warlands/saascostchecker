-- Bloque 2.1 — Motor de alertas de renovación
-- Decisión de mecanismo (pendiente desde la migración a Railway, ver DECISIONS.md):
-- pg_cron dentro de Supabase, no un cron de Railway a un endpoint firmado — evita
-- que el motor dependa de que el contenedor de Railway esté sano/con las env vars
-- correctas (causa raíz del incidente de 500 del 2026-07-15), e idempotencia real
-- garantizada por un unique index de Postgres, no por lógica de aplicación.
--
-- Tabla: notifications
-- Helper: current_user_id()
-- Función: evaluate_renewal_alerts(p_today date) — idempotente, la ejecuta pg_cron
--   una vez al día; también invocable manualmente (tests con fechas simuladas).
-- RPCs: mark_notification_read(), mark_all_notifications_read()

-- =========================================================================
-- 1. HELPER
-- =========================================================================

create function public.current_user_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select id from public.users where auth_id = auth.uid()
$$;

-- =========================================================================
-- 2. TABLA: notifications
-- =========================================================================

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  user_id uuid not null references public.users (id) on delete cascade,
  type text not null check (type in ('renewal_alert')),
  -- Solo para dedupe/trazabilidad server-side; el destinatario puede no tener
  -- acceso RLS a `contracts` (p.ej. un employee marcado owner de un vendor), así
  -- que la UI nunca hace join contra esta FK — todo lo que necesita mostrar ya
  -- viene congelado en `payload` en el momento de generar la alerta.
  contract_id uuid references public.contracts (id) on delete cascade,
  -- 90/60/30/7 = umbral de días hasta renewal_date; -1 = sentinela de "preaviso
  -- de cancelación vencido" (deadline accionable = renewal_date - cancellation_notice_days).
  threshold_days integer,
  payload jsonb not null default '{}'::jsonb,
  -- Poblado en el bloque 2.2 (email/Teams); vacío hoy, este bloque solo persiste in-app.
  channels text[] not null default '{}'::text[],
  read_at timestamptz,
  sent_at timestamptz,
  created_at timestamptz not null default now()
);

create index notifications_user_unread_idx
  on public.notifications (user_id, created_at desc)
  where read_at is null;

-- Garantía real de idempotencia: ejecutar evaluate_renewal_alerts() dos veces el
-- mismo día (o el mismo cron job reintentado) no puede insertar la misma alerta
-- dos veces — lo impone el propio índice, no la lógica de la función.
create unique index notifications_renewal_alert_unique_idx
  on public.notifications (contract_id, user_id, threshold_days)
  where type = 'renewal_alert';

alter table public.notifications enable row level security;

create policy notifications_select on public.notifications
  for select to authenticated
  using (org_id = public.current_org_id() and user_id = public.current_user_id());

create policy notifications_no_insert on public.notifications
  for insert to authenticated
  with check (false);

create policy notifications_no_update on public.notifications
  for update to authenticated
  using (false);

create policy notifications_no_delete on public.notifications
  for delete to authenticated
  using (false);

-- =========================================================================
-- 3. RPCs de lectura (marcar como leída) — security definer, solo sus propias filas
-- =========================================================================

create function public.mark_notification_read(p_notification_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.notifications
  set read_at = now()
  where id = p_notification_id
    and user_id = public.current_user_id()
    and read_at is null;
end;
$$;

create function public.mark_all_notifications_read()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.notifications
  set read_at = now()
  where user_id = public.current_user_id()
    and read_at is null;
end;
$$;

-- =========================================================================
-- 4. MOTOR: evaluate_renewal_alerts()
-- =========================================================================
-- Destinatarios por contrato: owner_user_id del vendor + todo usuario `finance`
-- de la org. Sin owner -> solo finance (esa carencia ya se señala en el
-- dashboard, bloque 1.5). Un mismo usuario que sea owner Y finance recibe una
-- sola fila (distinct + el unique index la protege de todos modos).
create function public.evaluate_renewal_alerts(p_today date default current_date)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_inserted integer := 0;
  v_batch integer;
begin
  with due_contracts as (
    select
      c.id as contract_id,
      c.org_id,
      v.owner_user_id,
      v.name as vendor_name,
      c.name as contract_name,
      c.renewal_date,
      (c.renewal_date - p_today) as days_until
    from public.contracts c
    join public.vendors v on v.id = c.vendor_id
    where c.status = 'active'
      and (c.renewal_date - p_today) in (90, 60, 30, 7)
  ),
  recipients as (
    select distinct
      dc.contract_id, dc.org_id, dc.vendor_name, dc.contract_name, dc.renewal_date, dc.days_until,
      u.id as user_id
    from due_contracts dc
    join public.users u
      on u.org_id = dc.org_id
      and (u.id = dc.owner_user_id or u.role = 'finance')
  ),
  inserted as (
    insert into public.notifications (org_id, user_id, type, contract_id, threshold_days, payload)
    select
      r.org_id, r.user_id, 'renewal_alert', r.contract_id, r.days_until,
      jsonb_build_object(
        'vendor_name', r.vendor_name,
        'contract_name', r.contract_name,
        'renewal_date', r.renewal_date,
        'days_until', r.days_until
      )
    from recipients r
    on conflict (contract_id, user_id, threshold_days) where type = 'renewal_alert' do nothing
    returning 1
  )
  select count(*) into v_batch from inserted;
  v_inserted := v_inserted + v_batch;

  with due_notice as (
    select
      c.id as contract_id,
      c.org_id,
      v.owner_user_id,
      v.name as vendor_name,
      c.name as contract_name,
      c.renewal_date,
      c.cancellation_notice_days
    from public.contracts c
    join public.vendors v on v.id = c.vendor_id
    where c.status = 'active'
      and c.auto_renews
      and c.cancellation_notice_days > 0
      and (c.renewal_date - c.cancellation_notice_days) = p_today
  ),
  recipients2 as (
    select distinct
      dn.contract_id, dn.org_id, dn.vendor_name, dn.contract_name, dn.renewal_date, dn.cancellation_notice_days,
      u.id as user_id
    from due_notice dn
    join public.users u
      on u.org_id = dn.org_id
      and (u.id = dn.owner_user_id or u.role = 'finance')
  ),
  inserted2 as (
    insert into public.notifications (org_id, user_id, type, contract_id, threshold_days, payload)
    select
      r.org_id, r.user_id, 'renewal_alert', r.contract_id, -1,
      jsonb_build_object(
        'vendor_name', r.vendor_name,
        'contract_name', r.contract_name,
        'renewal_date', r.renewal_date,
        'notice_days', r.cancellation_notice_days,
        'notice_expired', true
      )
    from recipients2 r
    on conflict (contract_id, user_id, threshold_days) where type = 'renewal_alert' do nothing
    returning 1
  )
  select count(*) into v_batch from inserted2;
  v_inserted := v_inserted + v_batch;

  return v_inserted;
end;
$$;

-- Solo el cron (rol postgres, dueño de la función) y service_role la invocan.
-- Ningún cliente autenticado/anónimo debe poder forzar una pasada del motor.
revoke execute on function public.evaluate_renewal_alerts(date) from public;
revoke execute on function public.evaluate_renewal_alerts(date) from anon;
revoke execute on function public.evaluate_renewal_alerts(date) from authenticated;
grant execute on function public.evaluate_renewal_alerts(date) to service_role;

-- =========================================================================
-- 5. pg_cron: ejecución diaria
-- =========================================================================

create extension if not exists pg_cron;

grant usage on schema cron to postgres;
grant all privileges on all tables in schema cron to postgres;

-- cron.schedule() re-programa (no duplica) si ya existe un job con este nombre;
-- el `do` defensivo cubre versiones de pg_cron donde ese upsert no aplica.
do $$
begin
  if exists (select 1 from cron.job where jobname = 'renewal-alerts-daily') then
    perform cron.unschedule('renewal-alerts-daily');
  end if;
end;
$$;

-- 06:00 UTC — pg_cron corre siempre en UTC en Supabase hosted.
select cron.schedule(
  'renewal-alerts-daily',
  '0 6 * * *',
  $$select public.evaluate_renewal_alerts()$$
);
