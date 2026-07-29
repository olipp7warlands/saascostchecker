import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { AppLogo } from "@/components/catalog/app-logo";
import { StatusTimeline } from "@/components/requests/status-timeline";
import { Pill } from "@/components/ui/pill";
import { getCurrentUserProfile } from "@/features/auth/session";
import { REQUEST_STATUS_TONE } from "@/features/requests/status-tone";
import type { PurchaseRequestStatus } from "@/features/requests/timeline";
import { routing } from "@/i18n/routing";
import { createClient } from "@/lib/supabase/server";

export default async function RequestDetailPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  if (!hasLocale(routing.locales, locale)) {
    notFound();
  }
  setRequestLocale(locale);

  const t = await getTranslations("Requests");
  const tDetail = await getTranslations("Requests.detail");
  const profile = await getCurrentUserProfile();
  if (!profile) {
    notFound();
  }

  const supabase = await createClient();
  // RLS ya acota purchase_requests a requester_id = current_user_id(): la
  // solicitud de otro usuario simplemente no existe para esta consulta,
  // sin necesidad de comprobarlo aparte en código de aplicación.
  const { data: request, error } = await supabase
    .from("purchase_requests")
    .select(
      "id, vendor_name, estimated_annual_cost, currency, department_id, justification, alternatives_considered, status, created_at, catalog_id, saas_catalog(website)",
    )
    .eq("id", id)
    .single();

  if (error || !request) {
    notFound();
  }

  const departmentQuery = request.department_id
    ? await supabase.from("departments").select("name").eq("id", request.department_id).single()
    : null;
  const departmentName = departmentQuery?.data?.name ?? null;

  const catalogEntry = Array.isArray(request.saas_catalog)
    ? request.saas_catalog[0]
    : request.saas_catalog;

  const status = request.status as PurchaseRequestStatus;
  const costFormatter = new Intl.NumberFormat(locale, {
    style: "currency",
    currency: request.currency,
    maximumFractionDigits: 0,
  });
  const dateFormatter = new Intl.DateTimeFormat(locale, { day: "numeric", month: "long", year: "numeric" });

  return (
    <div className="mx-auto max-w-2xl">
      <a
        href={`/${locale}/requests`}
        className="text-xs font-medium text-ink-soft underline underline-offset-4 hover:text-ink"
      >
        {tDetail("back")}
      </a>

      <div className="mt-3 flex items-center gap-3">
        <AppLogo domain={catalogEntry?.website ?? null} name={request.vendor_name} size={40} />
        <div>
          <h1 className="font-disp text-2xl font-semibold tracking-tight text-ink sm:text-[26px]">
            {request.vendor_name}
          </h1>
          <p className="text-xs text-ink-soft">
            {tDetail("requestedOn", { date: dateFormatter.format(new Date(request.created_at)) })}
          </p>
        </div>
        <Pill tone={REQUEST_STATUS_TONE[status]} className="ml-auto">
          {t(`status.${status}`)}
        </Pill>
      </div>

      <div className="mt-6 grid grid-cols-1 gap-6 sm:grid-cols-[1.4fr_1fr]">
        <div className="flex flex-col gap-4 rounded-lg border border-line bg-surface p-4">
          <div>
            <p className="text-xs font-semibold tracking-wider text-ink-soft uppercase">
              {tDetail("costLabel")}
            </p>
            <p className="num mt-0.5 text-lg font-semibold text-ink">
              {costFormatter.format(Number(request.estimated_annual_cost))}
            </p>
          </div>
          <div>
            <p className="text-xs font-semibold tracking-wider text-ink-soft uppercase">
              {tDetail("departmentLabel")}
            </p>
            <p className="mt-0.5 text-sm text-ink">{departmentName ?? tDetail("noDepartment")}</p>
          </div>
          <div>
            <p className="text-xs font-semibold tracking-wider text-ink-soft uppercase">
              {tDetail("justificationLabel")}
            </p>
            <p className="mt-0.5 text-sm whitespace-pre-wrap text-ink">{request.justification}</p>
          </div>
          {request.alternatives_considered && (
            <div>
              <p className="text-xs font-semibold tracking-wider text-ink-soft uppercase">
                {tDetail("alternativesLabel")}
              </p>
              <p className="mt-0.5 text-sm whitespace-pre-wrap text-ink">
                {request.alternatives_considered}
              </p>
            </div>
          )}
        </div>

        <div className="rounded-lg border border-line bg-surface p-4">
          <StatusTimeline status={status} />
        </div>
      </div>
    </div>
  );
}
