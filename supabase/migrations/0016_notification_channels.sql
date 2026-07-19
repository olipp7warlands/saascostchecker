-- Bloque 2.2 — Canales (email + Teams para alertas de renovación)
-- Las alertas ya se generan (bloque 2.1, 0015_renewal_alerts.sql) y se
-- persisten en `notifications`, con `channels`/`sent_at` reservados y vacíos
-- explícitamente para este bloque. Aquí se añade:
--   1. `org_notification_settings` — config por org (email on/off, Teams
--      on/off + webhook URL), RLS MÁS ESTRICTA que `organizations`
--      (`organizations_select` permite lectura a toda la org; aquí ni
--      siquiera lectura para no-org_admin, nadie más lo necesita).
--   2. RPCs `upsert_org_notification_settings()`/`get_org_notification_settings()`
--      — mismo esqueleto que `create_company()` (0013), con `audit_log` en la
--      misma transacción (obligatorio: `audit_log_no_insert` bloquea insert
--      directo a cualquier no-security-definer, ver 0001).
--   3. Validación anti-SSRF de `teams_webhook_url` DENTRO del RPC (no solo en
--      Zod del formulario, que el cliente no controla): https obligatorio,
--      hostname anclado a *.webhook.office.com / *.logic.azure.com.
--   4. `pg_net` + una función `trigger_send_pending_notifications()` y un
--      SEGUNDO pg_cron (cada 15 min, independiente del diario de 2.1) que la
--      invoca — dispara una llamada HTTP a una ruta interna de la app
--      (`/api/cron/send-notifications`) que hace el envío real (plantillas +
--      Resend/Teams) en TypeScript. La URL base y el secreto compartido se
--      leen de GUCs de Postgres (`app.settings.site_url`/`app.settings.cron_secret`),
--      NO se hardcodean aquí, porque SQL no puede leer `.env` — ver el paso
--      manual pendiente más abajo y docs/DECISIONS.md.
--
-- PASO MANUAL PENDIENTE (no versionable como migración normal — `alter
-- database` no es transaccional con el resto y debe ejecutarse una sola vez
-- en el SQL editor del proyecto remoto tras aplicar esta migración):
--   alter database postgres set app.settings.site_url = 'https://saascostchecker-production.up.railway.app';
--   alter database postgres set app.settings.cron_secret = '<mismo valor que CRON_SECRET en Railway>';
-- Sin esto, `trigger_send_pending_notifications()` sale con un `raise
-- warning` y no hace nada (falla "abierto" hacia no-op, nunca rompe el cron).

-- =========================================================================
-- 1. EXTENSIÓN
-- =========================================================================

create extension if not exists pg_net;

-- =========================================================================
-- 2. TABLA: org_notification_settings
-- =========================================================================

create table public.org_notification_settings (
  org_id uuid primary key references public.organizations (id) on delete cascade,
  email_alerts_enabled boolean not null default true,
  teams_alerts_enabled boolean not null default false,
  teams_webhook_url text,
  updated_at timestamptz not null default now()
);

alter table public.org_notification_settings enable row level security;

-- Más estricto que `organizations_select` (0001): ni lectura para no-org_admin.
create policy org_notification_settings_select on public.org_notification_settings
  for select
  using (org_id = public.current_org_id() and public.current_user_role() = 'org_admin');

create policy org_notification_settings_no_insert on public.org_notification_settings
  for insert
  with check (false);

create policy org_notification_settings_no_update on public.org_notification_settings
  for update
  using (false);

create policy org_notification_settings_no_delete on public.org_notification_settings
  for delete
  using (false);

-- =========================================================================
-- 3. RPCs (SECURITY DEFINER — solo org_admin, mismo esqueleto que
-- create_company()/update_company() de 0013_companies.sql)
-- =========================================================================

create function public.upsert_org_notification_settings(
  p_email_alerts_enabled boolean,
  p_teams_alerts_enabled boolean,
  p_teams_webhook_url text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller public.users%rowtype;
  v_old public.org_notification_settings%rowtype;
begin
  select * into v_caller from public.users where auth_id = auth.uid();

  if v_caller.role <> 'org_admin' then
    raise exception 'insufficient privileges to manage notification settings';
  end if;

  if p_teams_alerts_enabled
     and (p_teams_webhook_url is null or length(trim(p_teams_webhook_url)) = 0) then
    raise exception 'teams_webhook_url is required when teams_alerts_enabled is true';
  end if;

  -- Anti-SSRF: revalidado aquí porque el RPC es security definer y no debe
  -- confiar en que el cliente (o el Zod del formulario) ya lo comprobó.
  -- Ancla el host exacto al final del dominio (no un `like '%...%'`) para
  -- que un truco tipo 'https://evil.com/webhook.office.com' no cuele.
  if p_teams_webhook_url is not null
     and length(trim(p_teams_webhook_url)) > 0
     and p_teams_webhook_url !~* '^https://([a-z0-9-]+\.)*(webhook\.office\.com|logic\.azure\.com)(/.*)?$' then
    raise exception 'teams_webhook_url must be an https URL on .webhook.office.com or .logic.azure.com';
  end if;

  select * into v_old
  from public.org_notification_settings
  where org_id = v_caller.org_id;

  insert into public.org_notification_settings (
    org_id, email_alerts_enabled, teams_alerts_enabled, teams_webhook_url, updated_at
  )
  values (
    v_caller.org_id, p_email_alerts_enabled, p_teams_alerts_enabled, p_teams_webhook_url, now()
  )
  on conflict (org_id) do update
    set email_alerts_enabled = excluded.email_alerts_enabled,
        teams_alerts_enabled = excluded.teams_alerts_enabled,
        teams_webhook_url = excluded.teams_webhook_url,
        updated_at = now();

  insert into public.audit_log (org_id, actor_id, action, entity, entity_id, diff)
  values (
    v_caller.org_id, v_caller.id, 'org_notification_settings.updated', 'org_notification_settings', v_caller.org_id,
    jsonb_build_object(
      'old', jsonb_build_object(
        'email_alerts_enabled', v_old.email_alerts_enabled,
        'teams_alerts_enabled', v_old.teams_alerts_enabled
      ),
      'new', jsonb_build_object(
        'email_alerts_enabled', p_email_alerts_enabled,
        'teams_alerts_enabled', p_teams_alerts_enabled
      )
    )
  );
end;
$$;

-- Lectura: security definer + defaults vía coalesce, para que el consumidor
-- (server action de la UI) no tenga que duplicar "email on/teams off por
-- defecto" en TypeScript cuando aún no existe fila.
create function public.get_org_notification_settings()
returns table (
  email_alerts_enabled boolean,
  teams_alerts_enabled boolean,
  teams_webhook_url text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_caller public.users%rowtype;
begin
  select * into v_caller from public.users where auth_id = auth.uid();

  if v_caller.role <> 'org_admin' then
    raise exception 'insufficient privileges to read notification settings';
  end if;

  return query
  select
    coalesce(s.email_alerts_enabled, true),
    coalesce(s.teams_alerts_enabled, false),
    s.teams_webhook_url
  from (select 1) as dummy
  left join public.org_notification_settings s on s.org_id = v_caller.org_id;
end;
$$;

-- =========================================================================
-- 4. TRIGGER DE ENVÍO: pg_net + pg_cron (independiente del cron diario de 2.1)
-- =========================================================================

create function public.trigger_send_pending_notifications()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_site_url text;
  v_secret text;
begin
  v_site_url := current_setting('app.settings.site_url', true);
  v_secret := current_setting('app.settings.cron_secret', true);

  if v_site_url is null or v_secret is null then
    raise warning 'app.settings.site_url/cron_secret not configured, skipping send-notifications trigger';
    return;
  end if;

  perform net.http_post(
    url := v_site_url || '/api/cron/send-notifications',
    body := '{}'::jsonb,
    headers := jsonb_build_object('Content-Type', 'application/json', 'X-Cron-Secret', v_secret),
    timeout_milliseconds := 20000
  );
end;
$$;

revoke execute on function public.trigger_send_pending_notifications() from public;
revoke execute on function public.trigger_send_pending_notifications() from anon;
revoke execute on function public.trigger_send_pending_notifications() from authenticated;
grant execute on function public.trigger_send_pending_notifications() to service_role;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'send-pending-notifications') then
    perform cron.unschedule('send-pending-notifications');
  end if;
end;
$$;

select cron.schedule(
  'send-pending-notifications',
  '*/15 * * * *',
  $$select public.trigger_send_pending_notifications()$$
);
