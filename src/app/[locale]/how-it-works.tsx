import { getTranslations } from "next-intl/server";

const STEPS = ["step1", "step2", "step3"] as const;

export async function HowItWorks() {
  const t = await getTranslations("Home.how");

  return (
    <section id="como" className="mx-4 rounded-3xl bg-ink text-[#C9D2D6] sm:mx-6">
      <div className="mx-auto max-w-[1032px] px-6 py-20">
        <div className="mb-3 font-mono text-xs tracking-[.12em] text-[#5FBFB4] uppercase">{t("kicker")}</div>
        <h2 className="mb-3.5 max-w-[640px] font-disp text-[clamp(26px,3.6vw,38px)] leading-[1.12] font-bold tracking-tight text-white">
          {t("title")}
        </h2>
        <p className="max-w-[560px] text-[17px] text-[#9AA7AE]">{t("subtitle")}</p>
        <div className="mt-11 grid grid-cols-1 gap-4 md:grid-cols-3">
          {STEPS.map((step) => (
            <div key={step} className="rounded-[14px] border border-white/12 bg-white/3 p-6.5">
              <span className="mb-3 block font-mono text-xs tracking-[.1em] text-[#5FBFB4]">
                {t(`${step}.label`)}
              </span>
              <b className="mb-2 block font-disp text-[17px] font-semibold text-white">{t(`${step}.title`)}</b>
              <p className="text-sm text-[#C9D2D6]">{t(`${step}.body`)}</p>
              <span className="mt-3.5 inline-block rounded-md bg-[#5FBFB4]/14 px-2.25 py-1 font-mono text-[11px] text-[#5FBFB4]">
                {t(`${step}.chip`)}
              </span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
