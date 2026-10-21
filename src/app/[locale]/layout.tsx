import { NextIntlClientProvider } from "next-intl";
import { setRequestLocale } from "next-intl/server";
import { connection } from "next/server";
import { getDatabase } from "@/server/db/client";
import { listProducts } from "@/server/catalog/service";
import { notFound } from "next/navigation";
import { messages, type Locale } from "@/i18n/messages";
import { DemoProvider } from "@/demo/provider";
import { SiteShell } from "@/components/layout/site-shell";
import { AuthSessionProvider } from "@/features/authentication/session-provider";
import "@/styles/globals.css";
export const metadata = {
  title: "UNLOCK-ALL — Gaming Demo",
  description: "Boutique gaming de démonstration / Gaming store prototype",
  robots: { index: false, follow: false },
};
export default async function LocaleLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (locale !== "fr" && locale !== "en") notFound();
  setRequestLocale(locale);
  await connection();
  const products = await listProducts(getDatabase());
  return (
    <html lang={locale} data-scroll-behavior="smooth">
      <body>
        <NextIntlClientProvider
          locale={locale}
          messages={messages[locale as Locale]}
          timeZone="Europe/Paris"
        >
          <AuthSessionProvider>
            <DemoProvider initialProducts={products}>
              <SiteShell>{children}</SiteShell>
            </DemoProvider>
          </AuthSessionProvider>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
