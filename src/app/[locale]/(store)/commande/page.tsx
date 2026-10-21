import { Checkout } from "@/features/checkout/checkout";
import { ProtectedDemoPage } from "@/components/protected-demo-page";
import { pageMetadata } from "@/i18n/metadata";
export const generateMetadata = pageMetadata("checkout");
export default async function Page({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  return (
    <ProtectedDemoPage locale={locale} next="commande">
      <Checkout />
    </ProtectedDemoPage>
  );
}
