import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { getCurrentUserProfile } from "@/features/auth/session";
import { routing } from "@/i18n/routing";
import { createClient } from "@/lib/supabase/server";
import { ContractRow } from "./contract-row";
import { NewContractForm } from "./new-contract-form";
import { VendorEditForm } from "./vendor-edit-form";

const MANAGER_ROLES = ["finance", "it_admin", "org_admin"];

export default async function VendorDetailPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
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
  const [{ data: vendor }, { data: contracts }, { data: members }] = await Promise.all([
    supabase.from("vendors").select("*").eq("id", id).single(),
    supabase
      .from("contracts")
      .select("*")
      .eq("vendor_id", id)
      .order("start_date", { ascending: false }),
    supabase.from("users").select("id, full_name, email").order("full_name", { ascending: true }),
  ]);

  if (!vendor) {
    notFound();
  }

  return (
    <div className="mx-auto max-w-2xl">
      <a href={`/${locale}/vendors`} className="text-sm text-ink-soft hover:text-ink">
        {t("detail.back")}
      </a>
      <h1 className="mt-2 font-disp text-2xl font-semibold tracking-tight text-ink sm:text-[26px]">
        {vendor.name}
      </h1>

      <div className="mt-6">
        <h2 className="mb-2 font-disp text-lg font-semibold text-ink">
          {t("detail.vendorFieldsTitle")}
        </h2>
        <VendorEditForm locale={locale} vendor={vendor} members={members ?? []} />
      </div>

      <div className="mt-8">
        <h2 className="font-disp text-lg font-semibold text-ink">{t("detail.contractsTitle")}</h2>
        <ul className="mt-3 flex flex-col gap-3">
          {(contracts ?? []).map((contract) => (
            <ContractRow key={contract.id} contract={contract} />
          ))}
        </ul>
        <div className="mt-4 rounded-lg border border-dashed border-line p-4">
          <h3 className="mb-2 text-sm font-semibold text-ink">{t("detail.addContract")}</h3>
          <NewContractForm vendorId={vendor.id} />
        </div>
      </div>
    </div>
  );
}
