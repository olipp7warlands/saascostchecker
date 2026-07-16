import { getTranslations } from "next-intl/server";
import { CtaLink } from "./cta-link";

export async function HomeFinalCta({ locale }: { locale: string }) {
  const t = await getTranslations("Home.final");

  return (
    <section className="px-6 py-24 text-center">
      <h2 className="mx-auto mb-3.5 max-w-[560px] font-disp text-[clamp(26px,3.6vw,38px)] leading-[1.12] font-bold tracking-tight text-ink">
        {t("title")}
      </h2>
      <p className="mx-auto mb-7.5 max-w-[560px] text-[17px] text-ink-soft">{t("subtitle")}</p>
      <CtaLink href={`/${locale}/signup`} size="big">
        {t("cta")}
      </CtaLink>
    </section>
  );
}
