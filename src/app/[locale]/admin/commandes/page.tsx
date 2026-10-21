import { Admin } from "@/features/administration/admin";
import { ProtectedDemoPage } from "@/components/protected-demo-page";
import { pageMetadata } from "@/i18n/metadata";
export const generateMetadata = pageMetadata("manageOrders");
export default async function Page({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  return (
    <ProtectedDemoPage locale={locale} next="admin" admin>
      <Admin section="commandes" />
    </ProtectedDemoPage>
  );
}
