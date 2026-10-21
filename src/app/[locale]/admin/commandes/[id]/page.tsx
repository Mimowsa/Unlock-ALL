import { OrderDetails } from "@/features/account/account";
import { ProtectedDemoPage } from "@/components/protected-demo-page";
import { pageMetadata } from "@/i18n/metadata";
export const generateMetadata = pageMetadata("orderDetails");
export default async function Page({
  params,
}: {
  params: Promise<{ id: string; locale: string }>;
}) {
  const { id, locale } = await params;
  return (
    <ProtectedDemoPage locale={locale} next="admin" admin>
      <OrderDetails id={id} admin />
    </ProtectedDemoPage>
  );
}
