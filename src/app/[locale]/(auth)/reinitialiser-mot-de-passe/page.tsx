import { PasswordReset } from "@/features/authentication/auth";
import { DemoPage } from "@/components/demo-page";
import { pageMetadata } from "@/i18n/metadata";
export const generateMetadata = pageMetadata("forgot");
export default function Page() {
  return (
    <DemoPage>
      <PasswordReset complete />
    </DemoPage>
  );
}
