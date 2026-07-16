import { getTranslations } from "next-intl/server";
import { Wordmark } from "@/components/brand/wordmark";
import { CtaLink } from "./cta-link";

export async function HomeNav({ locale }: { locale: string }) {
  const t = await getTranslations("Home.nav");

  const navLinks = [
    { href: "#producto", label: t("product") },
    { href: "#ia", label: t("ai") },
    { href: "#como", label: t("how") },
    { href: "#funciones", label: t("features") },
  ];

  return (
    <header className="sticky top-0 z-50 border-b border-line bg-bg/92 backdrop-blur-sm">
      <div className="mx-auto flex h-[62px] max-w-[1080px] items-center gap-4 px-4 sm:gap-7 sm:px-6">
        <a href={`/${locale}`}>
          <Wordmark className="text-[21px] text-ink" />
        </a>
        <nav className="ml-2 hidden gap-5.5 md:flex">
          {navLinks.map((link) => (
            <a
              key={link.href}
              href={link.href}
              className="text-[14.5px] font-medium text-ink-soft hover:text-ink"
            >
              {link.label}
            </a>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-2 sm:gap-2.5">
          <CtaLink href={`/${locale}/login`} variant="ghost" className="hidden px-3.5 py-2 text-sm sm:inline-block sm:px-5 sm:py-2.5 sm:text-[15px]">
            {t("login")}
          </CtaLink>
          <CtaLink href={`/${locale}/signup`} className="px-3.5 py-2 text-sm sm:px-5 sm:py-2.5 sm:text-[15px]">
            {t("signup")}
          </CtaLink>
        </div>
      </div>
    </header>
  );
}
