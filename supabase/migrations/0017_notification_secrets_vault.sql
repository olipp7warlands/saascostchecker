-- Bloque 2.2 — Sustituye el GUC de Postgres por Supabase Vault para
-- site_url/cron_secret en trigger_send_pending_notifications().
--
-- El paso manual documentado en 0016 (`alter database postgres set
-- app.settings.*` / `alter role postgres set ...`) falla en el proyecto
-- remoto gestionado con "permission denied to set parameter": el rol
-- `postgres` de un proyecto Supabase gestionado no tiene privilegio para
-- fijar parámetros a nivel de database/role, aunque sea dueño de la
-- función que los leería. El GUC queda descartado — ver docs/DECISIONS.md.
--
-- Sustituido por Supabase Vault (`vault.decrypted_secrets`), pensado
-- exactamente para este caso: secretos legibles en runtime por funciones
-- SECURITY DEFINER sin depender de GUCs de sesión/database. Comportamiento
-- defensivo sin cambios respecto a 0016: si alguno de los dos secretos no
-- existe todavía en Vault, `raise warning` y salir sin error (el cron
-- nunca debe romperse por falta de configuración).
--
-- PASO MANUAL PENDIENTE (una sola vez en el proyecto remoto, no
-- versionable como SQL de migración porque el valor es un secreto): crear
-- los 2 secretos en Vault. Ver docs/DECISIONS.md para el SQL exacto.

create extension if not exists supabase_vault with schema vault;

create or replace function public.trigger_send_pending_notifications()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_site_url text;
  v_secret text;
begin
  select decrypted_secret into v_site_url
  from vault.decrypted_secrets
  where name = 'site_url';

  select decrypted_secret into v_secret
  from vault.decrypted_secrets
  where name = 'cron_secret';

  if v_site_url is null or v_secret is null then
    raise warning 'site_url/cron_secret not configured in Supabase Vault, skipping send-notifications trigger';
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

-- `create or replace function` preserva el ACL existente para la misma
-- firma, pero se repite explícitamente por idempotencia defensiva (mismo
-- patrón que 0016) por si esta migración se llegara a aplicar alguna vez
-- de forma aislada.
revoke execute on function public.trigger_send_pending_notifications() from public;
revoke execute on function public.trigger_send_pending_notifications() from anon;
revoke execute on function public.trigger_send_pending_notifications() from authenticated;
grant execute on function public.trigger_send_pending_notifications() to service_role;

-- =========================================================================
-- Verificación en el propio deploy: ningún rol de cliente puede leer
-- vault.decrypted_secrets ni vault.secrets, directamente ni por herencia
-- de PUBLIC. Esta máquina no tiene Supabase local (ver CLAUDE.md) para
-- inspeccionar grants a mano, así que la comprobación viaja dentro de la
-- migración y se re-ejecuta en cada `supabase db push`: si algún rol
-- cliente tuviera acceso, el push debe fallar aquí en vez de dejar
-- secretos expuestos en silencio. `trigger_send_pending_notifications()`
-- es, además, la única función del repo que toca `vault.*`, y nunca
-- devuelve los valores leídos a quien la invoque (returns void).
-- =========================================================================

do $$
begin
  if has_table_privilege('anon', 'vault.decrypted_secrets', 'SELECT')
     or has_table_privilege('authenticated', 'vault.decrypted_secrets', 'SELECT') then
    raise exception 'vault.decrypted_secrets is readable by anon/authenticated — must remain postgres/service_role only';
  end if;

  if has_table_privilege('anon', 'vault.secrets', 'SELECT')
     or has_table_privilege('authenticated', 'vault.secrets', 'SELECT') then
    raise exception 'vault.secrets is readable by anon/authenticated — must remain postgres/service_role only';
  end if;
end;
$$;
