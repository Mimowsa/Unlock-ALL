import { Cart } from "@/features/cart/cart";
import { DemoPage } from "@/components/demo-page";
import { pageMetadata } from "@/i18n/metadata";
export const generateMetadata = pageMetadata("cart");
export default function Page() {
  return (
    <DemoPage>
      <Cart />
    </DemoPage>
  );
}
