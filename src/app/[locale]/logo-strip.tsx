import { getTranslations } from "next-intl/server";
import { AppLogo } from "@/components/catalog/app-logo";

const LOGOS = [
  { name: "ChatGPT", website: "openai.com" },
  { name: "Claude", website: "anthropic.com" },
  { name: "Midjourney", website: "midjourney.com" },
  { name: "Slack", website: "slack.com" },
  { name: "Salesforce", website: "salesforce.com" },
  { name: "Figma", website: "figma.com" },
  { name: "Notion", website: "notion.so" },
];

export async function LogoStrip() {
  const t = await getTranslations("Home.logoStrip");

  return (
    <div className="px-6 pt-10 pb-2 text-center">
      <p className="mb-4 text-xs tracking-[.1em] text-ink-soft uppercase">{t("label")}</p>
      <div className="flex flex-wrap justify-center gap-6.5 opacity-75">
        {LOGOS.map((logo) => (
          <span key={logo.name} className="flex items-center gap-1.75 text-sm font-semibold text-ink-soft">
            <AppLogo domain={logo.website} name={logo.name} size={20} />
            {logo.name}
          </span>
        ))}
        <span className="text-sm font-semibold text-ink-soft">{t("more")}</span>
      </div>
    </div>
  );
}
