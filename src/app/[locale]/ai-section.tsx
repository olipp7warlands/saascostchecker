import { getTranslations } from "next-intl/server";
import { StatCard } from "./stat-card";

export async function AiSection() {
  const t = await getTranslations("Home.ai");

  return (
    <section id="ia" className="mx-auto max-w-[1080px] px-6 py-21">
      <div className="mb-3 font-mono text-xs tracking-[.12em] text-primary uppercase">{t("kicker")}</div>
      <h2 className="mb-3.5 max-w-[640px] font-disp text-[clamp(26px,3.6vw,38px)] leading-[1.12] font-bold tracking-tight text-ink">
        {t("title")}
      </h2>
      <p className="max-w-[560px] text-[17px] text-ink-soft">{t("subtitle")}</p>
      <div className="mt-11 grid grid-cols-1 gap-4 md:grid-cols-3">
        <StatCard stat={t("catalog.stat")} title={t("catalog.title")} body={t("catalog.body")} tone="teal" />
        <StatCard stat={t("duplicated.stat")} title={t("duplicated.title")} body={t("duplicated.body")} tone="amber" />
        <StatCard stat={t("variable.stat")} title={t("variable.title")} body={t("variable.body")} tone="red" />
      </div>
    </section>
  );
}
