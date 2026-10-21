import { Home } from "@/features/catalog/home";
import { DemoPage } from "@/components/demo-page";
import { pageMetadata } from "@/i18n/metadata";
export const generateMetadata = pageMetadata("home");
export default function Page() {
  return (
    <DemoPage>
      <Home />
    </DemoPage>
  );
}
