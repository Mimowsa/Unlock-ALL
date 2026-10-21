import { Support } from "@/features/support/support";
import { DemoPage } from "@/components/demo-page";
import { pageMetadata } from "@/i18n/metadata";
export const generateMetadata = pageMetadata("support");
export default function Page() {
  return (
    <DemoPage>
      <Support />
    </DemoPage>
  );
}
