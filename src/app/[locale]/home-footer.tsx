import { getTranslations } from "next-intl/server";
import { Wordmark } from "@/components/brand/wordmark";

export async function HomeFooter() {
  const t = await getTranslations("Home.footer");

  return (
    <footer className="border-t border-line px-6 py-7 text-[13.5px] text-ink-soft">
      <div className="mx-auto flex max-w-[1080px] flex-wrap justify-between gap-3.5">
        <span>
          <Wordmark className="text-ink" /> — {t("tagline")}
        </span>
        <span>{t("links")}</span>
      </div>
    </footer>
  );
}
