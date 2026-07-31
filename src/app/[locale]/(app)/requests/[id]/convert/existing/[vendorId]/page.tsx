import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound, redirect } from "next/navigation";
import { AppLogo } from "@/components/catalog/app-logo";
import { getCurrentUserProfile } from "@/features/auth/session";
import { routing } from "@/i18n/routing";
import { createClient } from "@/lib/supabase/server";
import { AddContractForRequestForm } from "./add-contract-for-request-form";

const VENDOR_MANAGER_ROLES = ["finance", "it_admin", "org_admin"];

// Bloque 3.3: camino "vendor ya existente" del intersticial de conversión —
// mismo gate server-side que /requests/[id]/convert (rol + estado approved +
// no convertida ya), no solo un enlace escondido.
export default async function ConvertToExistingVendorPage({
  params,
}: {
  params: Promise<{ locale: string; id: string; vendorId: string }>;
}) {
  const { locale, id, vendorId } = await params;
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
  const [{ data: request }, { data: vendor }, { data: departments }, { data: companies }] = await Promise.all([
    supabase
      .from("purchase_requests")
      .select("id, vendor_name, estimated_annual_cost, currency, department_id, status, converted_contract_id")
      .eq("id", id)
      .single(),
    // vendors_select ya acota a finance/it_admin/org_admin de la org — un
    // vendorId de otra org o inventado simplemente no existe para esta query.
    supabase.from("vendors").select("id, name, website").eq("id", vendorId).single(),
    supabase.from("departments").select("id, name").order("name", { ascending: true }),
    supabase.from("companies").select("id, name").order("name", { ascending: true }),
  ]);

  if (!request || !vendor) {
    notFound();
  }

  if (request.status !== "approved" || request.converted_contract_id) {
    redirect(`/${locale}/requests/${id}`);
  }

  return (
    <div className="mx-auto max-w-2xl">
      <a
        href={`/${locale}/requests/${id}/convert`}
        className="text-xs font-medium text-ink-soft underline underline-offset-4 hover:text-ink"
      >
        {t("existing.back")}
      </a>

      <div className="mt-3 flex items-center gap-3">
        <AppLogo domain={vendor.website} name={vendor.name} size={32} />
        <h1 className="font-disp text-2xl font-semibold tracking-tight text-ink sm:text-[26px]">
          {t("existing.title", { vendor: vendor.name })}
        </h1>
      </div>

      <div className="mt-6">
        <AddContractForRequestForm
          locale={locale}
          requestId={request.id}
          vendorId={vendor.id}
          departments={departments ?? []}
          companies={companies ?? []}
          canManageOrgDimensions={profile.role === "org_admin"}
          defaultValues={{
            contractName: request.vendor_name,
            costAmount: Number(request.estimated_annual_cost),
            currency: request.currency,
            departmentId: request.department_id,
          }}
        />
      </div>
    </div>
  );
}
