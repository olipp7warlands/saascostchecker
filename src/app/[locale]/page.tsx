import { useTranslations } from "next-intl";
import { setRequestLocale } from "next-intl/server";
import { routing } from "@/i18n/routing";

export default async function Home({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  return <HomeContent />;
}

function HomeContent() {
  const t = useTranslations("HomePage");

  return (
    <div className="min-h-screen bg-bg p-8 sm:p-16">
      <main className="mx-auto flex max-w-xl flex-col gap-6">
        <div>
          <p className="text-xs uppercase tracking-widest text-ink-soft">
            {t("greeting")}
          </p>
          <h1 className="font-disp text-3xl font-semibold tracking-tight text-ink">
            {t("title")}
          </h1>
          <p className="mt-1 text-ink-soft">{t("tagline")}</p>
        </div>

        <div className="rounded-xl border border-line bg-surface p-5">
          <p className="text-xs text-ink-soft">{t("sampleLabel")}</p>
          <p className="num mt-1 text-2xl font-semibold text-ink">
            42.180,00&nbsp;€
          </p>
        </div>

        <nav className="flex items-center gap-3 text-sm">
          <span className="text-ink-soft">{t("localeSwitchLabel")}:</span>
          {routing.locales.map((loc) => (
            <a
              key={loc}
              href={`/${loc}`}
              className="rounded-full border border-line bg-surface px-3 py-1 font-medium text-ink hover:border-primary hover:text-primary"
            >
              {loc.toUpperCase()}
            </a>
          ))}
        </nav>
      </main>
    </div>
  );
}
