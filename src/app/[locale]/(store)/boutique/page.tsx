import { Catalog } from "@/features/catalog/catalog";
import { DemoPage } from "@/components/demo-page";
import { pageMetadata } from "@/i18n/metadata";
export const generateMetadata = pageMetadata("shop");
export default function Page() {
  return (
    <DemoPage>
      <Catalog />
    </DemoPage>
  );
}
