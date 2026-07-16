import { getTranslations } from "next-intl/server";
import { CtaLink } from "./cta-link";
import { RenewalDemo } from "./renewal-demo";

export async function HomeHero({ locale }: { locale: string }) {
  const t = await getTranslations("Home.hero");

  return (
    <section className="px-6 pt-19 pb-7.5 text-center">
      <span className="mb-5.5 inline-block rounded-full bg-primary-soft px-3.5 py-1.5 font-mono text-xs tracking-[.12em] text-primary uppercase">
        {t("eyebrow")}
      </span>
      <h1 className="mx-auto max-w-[820px] font-disp text-[clamp(34px,5.6vw,58px)] leading-[1.06] font-extrabold tracking-tight text-ink">
        {t("titleMain")} <em className="text-destructive not-italic">{t("titleEmphasis")}</em>
      </h1>
      <p className="mx-auto mt-4.5 mb-7.5 max-w-[620px] text-[clamp(16px,2vw,19px)] text-ink-soft">
        {t("subtitle")}
      </p>
      <div className="mb-3 flex flex-wrap justify-center gap-3">
        <CtaLink href={`/${locale}/signup`} size="big">
          {t("ctaPrimary")}
        </CtaLink>
        <CtaLink href="#como" variant="ghost" size="big">
          {t("ctaSecondary")}
        </CtaLink>
      </div>
      <span className="text-[13px] text-ink-soft">{t("micro")}</span>

      <RenewalDemo locale={locale} />
    </section>
  );
}
