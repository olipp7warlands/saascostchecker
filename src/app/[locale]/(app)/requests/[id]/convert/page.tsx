import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound, redirect } from "next/navigation";
import { AppLogo } from "@/components/catalog/app-logo";
import { getCurrentUserProfile } from "@/features/auth/session";
import { buildVendorPrefillHref } from "@/features/requests/vendor-prefill";
import { routing } from "@/i18n/routing";
import { createClient } from "@/lib/supabase/server";

const VENDOR_MANAGER_ROLES = ["finance", "it_admin", "org_admin"];

// Bloque 3.3: intersticial entre "solicitud aprobada" y "vendor/contrato".
// Gate server-side (rol + estado) ANTES de renderizar nada — no basta con
// esconder el enlace en la ficha de la solicitud, una URL directa a una
// solicitud ajena, no aprobada, o ya convertida no debe exponer este paso.
export default async function ConvertRequestPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  if (!hasLocale(routing.locales, locale)) {
    notFound();
  }
  setRequestLocale(locale);

  const t = await getTranslations("Requests.convert");
  const profile = await getCurrentUserProfile();
  if (!profile || !VENDOR_MANAGER_ROLES.includes(profile.role)) {
    notFound();
  }

  const supabase = await createClient();
  // RLS acota purchase_requests a requester_id = current_user_id() o a
  // finance/org_admin de la org — una solicitud fuera de esas dos
  // condiciones simplemente no existe para esta consulta (404 más abajo).
  const { data: request } = await supabase
    .from("purchase_requests")
    .select(
      "id, vendor_name, estimated_annual_cost, currency, department_id, catalog_id, status, converted_contract_id, saas_catalog(website)",
    )
    .eq("id", id)
    .single();

  if (!request) {
    notFound();
  }

  if (request.status !== "approved" || request.converted_contract_id) {
    redirect(`/${locale}/requests/${id}`);
  }

  const catalogEntry = Array.isArray(request.saas_catalog) ? request.saas_catalog[0] : request.saas_catalog;

  const createNewHref = buildVendorPrefillHref(locale, {
    id: request.id,
    catalogId: request.catalog_id,
    vendorName: request.vendor_name,
    departmentId: request.department_id,
    estimatedAnnualCost: Number(request.estimated_annual_cost),
    currency: request.currency,
  });

  // Detección de "vendor ya existente" — match exacto por catalog_id (única
  // señal fiable sin heurística nueva). Sin catalog_id (herramienta custom),
  // no hay nada que matchear: va directo a "crear nuevo" como en 3.1b.
  const { data: matches } = request.catalog_id
    ? await supabase
        .from("vendors")
        .select("id, name, website")
        .eq("catalog_id", request.catalog_id)
        .order("name", { ascending: true })
    : { data: [] as { id: string; name: string; website: string }[] };

  if (!matches || matches.length === 0) {
    redirect(createNewHref);
  }

  return (
    <div className="mx-auto max-w-2xl">
      <a
        href={`/${locale}/requests/${id}`}
        className="text-xs font-medium text-ink-soft underline underline-offset-4 hover:text-ink"
      >
        {t("back")}
      </a>

      <h1 className="mt-3 font-disp text-2xl font-semibold tracking-tight text-ink sm:text-[26px]">
        {t("title")}
      </h1>

      <div className="mt-6 rounded-lg border border-line bg-surface p-4">
        <div className="flex items-center gap-3">
          <AppLogo domain={catalogEntry?.website ?? null} name={request.vendor_name} size={32} />
          <p className="text-sm text-ink">{t("matchTitle", { vendor: request.vendor_name })}</p>
        </div>
        <p className="mt-1.5 text-xs text-ink-soft">{t("matchDescription")}</p>

        <div className="mt-4 flex flex-col gap-2">
          {matches.map((vendor) => (
            <a
              key={vendor.id}
              href={`/${locale}/requests/${id}/convert/existing/${vendor.id}`}
              className="flex items-center gap-3 rounded-lg border border-line px-3 py-2.5 hover:bg-muted/40"
            >
              <AppLogo domain={vendor.website} name={vendor.name} size={28} />
              <span className="text-sm font-medium text-ink">{vendor.name}</span>
              <span className="ml-auto text-xs font-medium text-ink underline underline-offset-4">
                {t("linkExisting")}
              </span>
            </a>
          ))}
        </div>
      </div>

      <a
        href={createNewHref}
        className="mt-4 inline-flex text-xs font-medium text-ink-soft underline underline-offset-4 hover:text-ink"
      >
        {t("createNewAnyway")}
      </a>
    </div>
  );
}
