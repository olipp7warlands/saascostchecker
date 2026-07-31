import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { getCurrentUserProfile } from "@/features/auth/session";
import { routing } from "@/i18n/routing";
import { createClient } from "@/lib/supabase/server";
import { NewVendorForm } from "./new-vendor-form";

const MANAGER_ROLES = ["finance", "it_admin", "org_admin"];

export default async function NewVendorPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{
    catalog_id?: string;
    vendor_name?: string;
    department_id?: string;
    cost?: string;
    currency?: string;
    source_request_id?: string;
  }>;
}) {
  const { locale } = await params;
  const search = await searchParams;
  if (!hasLocale(routing.locales, locale)) {
    notFound();
  }
  setRequestLocale(locale);

  const t = await getTranslations("Vendors");
  const profile = await getCurrentUserProfile();

  if (!profile || !MANAGER_ROLES.includes(profile.role)) {
    return <p className="text-sm text-ink-soft">{t("forbidden")}</p>;
  }

  const supabase = await createClient();
  const [{ data: members }, { data: departments }, { data: companies }] = await Promise.all([
    supabase.from("users").select("id, full_name, email").order("full_name", { ascending: true }),
    supabase.from("departments").select("id, name").order("name", { ascending: true }),
    supabase.from("companies").select("id, name").order("name", { ascending: true }),
  ]);

  // Prefill desde "Crear vendor/contrato" en una solicitud aprobada (bloque
  // 3.1b) — sin automatismo, solo precarga: el humano confirma/edita y guarda.
  const catalogId = search.catalog_id ?? null;
  const prefillVendorName = search.vendor_name ?? null;
  const prefillDepartmentId = search.department_id ?? null;
  const prefillCost = search.cost ?? null;
  const prefillCurrency = search.currency ?? null;
  const sourceRequestId = search.source_request_id ?? null;

  const catalogEntry = catalogId
    ? (await supabase.from("saas_catalog").select("id, name, website, category").eq("id", catalogId).single())
        .data
    : null;

  const initialSelection = catalogEntry
    ? {
        catalogId: catalogEntry.id,
        name: catalogEntry.name,
        website: catalogEntry.website,
        category: catalogEntry.category,
        isCustom: false,
      }
    : prefillVendorName
      ? { catalogId: null, name: prefillVendorName, website: "", category: "other", isCustom: true }
      : null;

  const initialContract = prefillCost
    ? {
        costAmount: Number(prefillCost),
        currency: prefillCurrency ?? undefined,
        departmentId: prefillDepartmentId,
      }
    : null;

  return (
    <div className="mx-auto max-w-2xl">
      <p className="text-xs tracking-[.08em] text-ink-soft uppercase">{t("crumb")}</p>
      <h1 className="mt-1.5 font-disp text-2xl font-semibold tracking-tight text-ink sm:text-[26px]">
        {t("new.title")}
      </h1>
      <div className="mt-6">
        <NewVendorForm
          locale={locale}
          members={members ?? []}
          departments={departments ?? []}
          companies={companies ?? []}
          canManageOrgDimensions={profile.role === "org_admin"}
          initialSelection={initialSelection}
          initialContract={initialContract}
          sourceRequestId={sourceRequestId}
        />
      </div>
    </div>
  );
}
