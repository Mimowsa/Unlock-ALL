import { Auth } from "@/features/authentication/auth";
import { DemoPage } from "@/components/demo-page";
import { pageMetadata } from "@/i18n/metadata";
export const generateMetadata = pageMetadata("login");
export default function Page() {
  return (
    <DemoPage>
      <Auth />
    </DemoPage>
  );
}
