import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { Breadcrumbs } from "@/components/shell/breadcrumbs";
import { AppLogo } from "@/components/catalog/app-logo";
import { Pill } from "@/components/ui/pill";
import { REQUEST_STATUS_TONE } from "@/features/requests/status-tone";
import type { PurchaseRequestStatus } from "@/features/requests/timeline";
import { getCurrentUserProfile } from "@/features/auth/session";
import { routing } from "@/i18n/routing";
import { createClient } from "@/lib/supabase/server";

export default async function RequestsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) {
    notFound();
  }
  setRequestLocale(locale);

  const t = await getTranslations("Requests");
  const profile = await getCurrentUserProfile();
  if (!profile) {
    notFound();
  }

  const canApprove = ["finance", "org_admin"].includes(profile.role);

  const supabase = await createClient();
  // RLS ya resuelve el alcance: employee/manager solo ven las suyas,
  // finance/org_admin ven todas las de la org (bloque 3.1b) — sin filtro
  // adicional en la query.
  const [{ data: requests }, { data: departments }] = await Promise.all([
    supabase
      .from("purchase_requests")
      .select(
        "id, vendor_name, estimated_annual_cost, currency, department_id, status, created_at, users(full_name, email)",
      )
      .order("created_at", { ascending: false }),
    supabase.from("departments").select("id, name"),
  ]);

  const departmentsById = new Map((departments ?? []).map((dept) => [dept.id, dept.name]));
  const dateFormatter = new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", year: "numeric" });

  return (
    <div>
      <Breadcrumbs items={[{ label: t("crumb") }]} />
      <div className="mt-1.5 flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-disp text-2xl font-semibold tracking-tight text-ink sm:text-[26px]">
          {t("title")}
        </h1>
        <a
          href={`/${locale}/requests/new`}
          className="inline-flex h-9 items-center rounded-btn bg-primary px-4 text-sm font-semibold text-primary-foreground hover:bg-[#2A2E30]"
        >
          {t("addButton")}
        </a>
      </div>

      {!requests || requests.length === 0 ? (
        <p className="mt-6 text-sm text-ink-soft">{canApprove ? t("emptyApprover") : t("empty")}</p>
      ) : (
        <div className="mt-6 rounded-xl border border-line bg-surface">
          <div className="overflow-x-auto contain-layout">
            <table className="w-full min-w-[640px] border-collapse">
              <thead>
                <tr>
                  <th className="border-b border-line px-4 py-2.5 text-left text-[11px] font-semibold tracking-wider text-ink-soft uppercase">
                    {t("table.vendor")}
                  </th>
                  {canApprove && (
                    <th className="border-b border-line px-4 py-2.5 text-left text-[11px] font-semibold tracking-wider text-ink-soft uppercase">
                      {t("table.requester")}
                    </th>
                  )}
                  <th className="border-b border-line px-4 py-2.5 text-left text-[11px] font-semibold tracking-wider text-ink-soft uppercase">
                    {t("table.cost")}
                  </th>
                  <th className="border-b border-line px-4 py-2.5 text-left text-[11px] font-semibold tracking-wider text-ink-soft uppercase">
                    {t("table.department")}
                  </th>
                  <th className="border-b border-line px-4 py-2.5 text-left text-[11px] font-semibold tracking-wider text-ink-soft uppercase">
                    {t("table.status")}
                  </th>
                  <th className="border-b border-line px-4 py-2.5 text-left text-[11px] font-semibold tracking-wider text-ink-soft uppercase">
                    {t("table.created")}
                  </th>
                </tr>
              </thead>
              <tbody>
                {requests.map((request) => {
                  const status = request.status as PurchaseRequestStatus;
                  const departmentName = request.department_id
                    ? (departmentsById.get(request.department_id) ?? null)
                    : null;
                  const requester = Array.isArray(request.users) ? request.users[0] : request.users;
                  const costFormatter = new Intl.NumberFormat(locale, {
                    style: "currency",
                    currency: request.currency,
                    maximumFractionDigits: 0,
                  });

                  return (
                    <tr key={request.id} className="hover:bg-muted/40">
                      <td className="border-b border-line px-4 py-3">
                        <a
                          href={`/${locale}/requests/${request.id}`}
                          className="flex items-center gap-2.5 font-medium text-ink underline underline-offset-4 hover:text-ink-soft"
                        >
                          <AppLogo domain={null} name={request.vendor_name} size={26} />
                          {request.vendor_name}
                        </a>
                      </td>
                      {canApprove && (
                        <td className="border-b border-line px-4 py-3 text-sm text-ink">
                          {requester?.full_name ?? requester?.email ?? "—"}
                        </td>
                      )}
                      <td className="num border-b border-line px-4 py-3 text-sm text-ink">
                        {costFormatter.format(Number(request.estimated_annual_cost))}
                      </td>
                      <td className="border-b border-line px-4 py-3 text-sm text-ink">
                        {departmentName ?? "—"}
                      </td>
                      <td className="border-b border-line px-4 py-3">
                        <Pill tone={REQUEST_STATUS_TONE[status]}>{t(`status.${status}`)}</Pill>
                      </td>
                      <td className="border-b border-line px-4 py-3 text-sm text-ink-soft">
                        {dateFormatter.format(new Date(request.created_at))}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
