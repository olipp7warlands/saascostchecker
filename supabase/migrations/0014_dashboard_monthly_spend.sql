-- Mini-bloque: gráficas del dashboard — evolución de gasto mensual.
-- Agregación en SQL (group by mes+moneda), no N+1: en vez de traer cada
-- spend_record a JS y sumar ahí, se agrupa en Postgres y solo se itera en JS
-- sobre (mes, moneda) para la conversión de divisa con convertAmount()
-- (src/features/dashboard/currency.ts) — un puñado de filas, nunca una por
-- spend_record.
--
-- Sin `security definer`: no hace falta bypass de RLS. La política
-- `spend_records_select` (0007_spend_import.sql, org_id + rol
-- finance/it_admin/org_admin) ya se aplica igual al ejecutarse esta función
-- como invoker — mismo patrón que search_saas_catalog() (0003), que tampoco
-- es security definer.
--
-- "Reconciliado" = spend_records.vendor_id is not null (se le asignó vendor
-- vía link_reconciliation()/create_vendor_from_reconciliation(), bloque
-- 1.3) — un movimiento todavía pendiente en reconciliation_queue no cuenta
-- como gasto real todavía.
create function public.dashboard_monthly_spend(p_months integer default 12)
returns table (spend_month date, currency char(3), total numeric)
language sql
stable
set search_path = ''
as $$
  select
    date_trunc('month', s.date)::date as spend_month,
    s.currency,
    sum(s.amount) as total
  from public.spend_records s
  where s.org_id = public.current_org_id()
    and s.vendor_id is not null
    and s.date >= (date_trunc('month', current_date) - (p_months - 1) * interval '1 month')
  group by 1, 2
  order by 1
$$;
