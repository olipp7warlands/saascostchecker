import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { getCurrentUserProfile } from "@/features/auth/session";
import { routing } from "@/i18n/routing";
import { createClient } from "@/lib/supabase/server";

const MANAGER_ROLES = ["finance", "it_admin", "org_admin"];

export default async function ImportPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) {
    notFound();
  }
  setRequestLocale(locale);

  const t = await getTranslations("SpendImport");
  const profile = await getCurrentUserProfile();

  if (!profile || !MANAGER_ROLES.includes(profile.role)) {
    return <p className="text-sm text-ink-soft">{t("forbidden")}</p>;
  }

  const supabase = await createClient();
  const { data: batches } = await supabase
    .from("import_batches")
    .select("id, original_filename, status, row_count, imported_count, duplicate_count, error_count, created_at")
    .order("created_at", { ascending: false });

  const dateFormatter = new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" });

  return (
    <div>
      <p className="text-xs tracking-[.08em] text-ink-soft uppercase">{t("crumb")}</p>
      <div className="mt-1.5 flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-disp text-2xl font-semibold tracking-tight text-ink sm:text-[26px]">
          {t("title")}
        </h1>
        <a
          href={`/${locale}/import/new`}
          className="inline-flex h-9 items-center rounded-btn bg-primary px-4 text-sm font-semibold text-primary-foreground hover:bg-[#2A2E30]"
        >
          {t("addButton")}
        </a>
      </div>

      {!batches || batches.length === 0 ? (
        <p className="mt-6 text-sm text-ink-soft">{t("empty")}</p>
      ) : (
        <div className="mt-6 rounded-xl border border-line bg-surface">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] border-collapse">
              <thead>
                <tr>
                  <th className="border-b border-line px-4 py-2.5 text-left text-[11px] font-semibold tracking-wider text-ink-soft uppercase">
                    {t("table.file")}
                  </th>
                  <th className="border-b border-line px-4 py-2.5 text-left text-[11px] font-semibold tracking-wider text-ink-soft uppercase">
                    {t("table.date")}
                  </th>
                  <th className="border-b border-line px-4 py-2.5 text-left text-[11px] font-semibold tracking-wider text-ink-soft uppercase">
                    {t("table.status")}
                  </th>
                  <th className="border-b border-line px-4 py-2.5 text-left text-[11px] font-semibold tracking-wider text-ink-soft uppercase">
                    {t("table.rows")}
                  </th>
                  <th className="border-b border-line px-4 py-2.5 text-left text-[11px] font-semibold tracking-wider text-ink-soft uppercase">
                    {t("table.imported")}
                  </th>
                  <th className="border-b border-line px-4 py-2.5 text-left text-[11px] font-semibold tracking-wider text-ink-soft uppercase">
                    {t("table.duplicates")}
                  </th>
                </tr>
              </thead>
              <tbody>
                {batches.map((batch) => (
                  <tr key={batch.id} className="hover:bg-muted/40">
                    <td className="border-b border-line px-4 py-3 text-sm font-medium text-ink">
                      {batch.original_filename}
                    </td>
                    <td className="border-b border-line px-4 py-3 text-sm text-ink-soft">
                      {dateFormatter.format(new Date(batch.created_at))}
                    </td>
                    <td className="border-b border-line px-4 py-3 text-sm text-ink-soft">
                      {t(`status.${batch.status}`)}
                    </td>
                    <td className="num border-b border-line px-4 py-3 text-sm text-ink">{batch.row_count}</td>
                    <td className="num border-b border-line px-4 py-3 text-sm text-ink">
                      {batch.imported_count}
                    </td>
                    <td className="num border-b border-line px-4 py-3 text-sm text-ink">
                      {batch.duplicate_count}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
