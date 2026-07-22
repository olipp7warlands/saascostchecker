import type { Metadata, Viewport } from "next";
import { IBM_Plex_Mono, Inter } from "next/font/google";
import { hasLocale, NextIntlClientProvider } from "next-intl";
import { setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { routing } from "@/i18n/routing";
import "../globals.css";

const inter = Inter({
  variable: "--font-sans",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

const ibmPlexMono = IBM_Plex_Mono({
  variable: "--font-mono",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
});

export const metadata: Metadata = {
  title: "StackX",
  description: "Visibilidad y control de tu stack de SaaS",
};

// Sin esto, no había ningún <meta name="viewport"> en toda la app (Next.js
// no inyecta uno por defecto) — en móvil real, el navegador caía al
// "layout viewport" heredado de sitios no responsive (~980px, escalado para
// que quepa en pantalla) en cuanto CUALQUIER elemento de la página excedía
// el ancho del dispositivo, aunque ese elemento ya estuviera correctamente
// contenido en un `overflow-x-auto` (visto en /vendors: su tabla
// `min-w-[720px]` expandía el viewport entero a ~859px, con `overflow-x-auto`
// funcionando perfectamente pero siendo irrelevante porque el navegador ya
// había decidido el ancho del viewport antes de que la contención CSS
// importara). Con `width: "device-width"` el viewport queda anclado al
// ancho real del dispositivo siempre, y el overflow-x-auto de cada tabla
// vuelve a ser lo único que decide su propio scroll interno.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export default async function LocaleLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) {
    notFound();
  }

  setRequestLocale(locale);

  return (
    <html lang={locale} className={`${inter.variable} ${ibmPlexMono.variable}`}>
      <body className="antialiased">
        <NextIntlClientProvider>{children}</NextIntlClientProvider>
      </body>
    </html>
  );
}
