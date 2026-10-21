import { Legal } from "@/features/support/support";
import { DemoPage } from "@/components/demo-page";
import { pageMetadata } from "@/i18n/metadata";
export const generateMetadata = pageMetadata("privacy");
export default function Page() {
  return (
    <DemoPage>
      <Legal page="confidentialite" />
    </DemoPage>
  );
}
