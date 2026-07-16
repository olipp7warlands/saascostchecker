import { getTranslations } from "next-intl/server";

const FEATURES = [
  { key: "dashboard", icon: "◫" },
  { key: "runway", icon: "◷" },
  { key: "inventory", icon: "▤" },
  { key: "licenses", icon: "◔" },
  { key: "reconciliation", icon: "⇄" },
  { key: "approvals", icon: "✓" },
] as const;

export async function FeaturesGrid() {
  const t = await getTranslations("Home.features");

  return (
    <section id="funciones" className="mx-auto max-w-[1080px] px-6 py-21">
      <div className="mb-3 font-mono text-xs tracking-[.12em] text-primary uppercase">{t("kicker")}</div>
      <h2 className="max-w-[640px] font-disp text-[clamp(26px,3.6vw,38px)] leading-[1.12] font-bold tracking-tight text-ink">
        {t("title")}
      </h2>
      <div className="mt-11 grid grid-cols-1 gap-3.5 md:grid-cols-2">
        {FEATURES.map((feature) => (
          <div key={feature.key} className="flex gap-3.5 rounded-xl border border-line bg-surface p-5">
            <div
              aria-hidden="true"
              className="flex size-8.5 shrink-0 items-center justify-center rounded-[9px] bg-primary-soft text-base text-primary"
            >
              {feature.icon}
            </div>
            <div>
              <b className="mb-0.5 block text-[15px] font-semibold text-ink">{t(`${feature.key}.title`)}</b>
              <p className="text-[13.5px] text-ink-soft">{t(`${feature.key}.body`)}</p>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
