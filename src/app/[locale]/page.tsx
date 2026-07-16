import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { getCurrentUserProfile } from "@/features/auth/session";
import { routing } from "@/i18n/routing";
import { AiSection } from "./ai-section";
import { FeaturesGrid } from "./features-grid";
import { HomeFinalCta } from "./home-final-cta";
import { HomeFooter } from "./home-footer";
import { HomeHero } from "./home-hero";
import { HomeNav } from "./home-nav";
import { HowItWorks } from "./how-it-works";
import { LogoStrip } from "./logo-strip";
import { PainsSection } from "./pains-section";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) {
    return {};
  }
  const t = await getTranslations({ locale, namespace: "Home.meta" });
  const title = t("title");
  const description = t("description");

  return {
    title,
    description,
    openGraph: { title, description, type: "website" },
  };
}

export default async function Home({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) {
    notFound();
  }
  setRequestLocale(locale);

  const profile = await getCurrentUserProfile();
  if (profile) {
    redirect(`/${locale}/dashboard`);
  }

  return (
    <div className="min-h-screen bg-bg">
      <HomeNav locale={locale} />
      <HomeHero locale={locale} />
      <LogoStrip />
      <PainsSection />
      <AiSection />
      <HowItWorks />
      <FeaturesGrid />
      <HomeFinalCta locale={locale} />
      <HomeFooter />
    </div>
  );
}
