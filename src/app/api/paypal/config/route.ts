import { getDatabase } from "@/server/db/client";
import { paypalEnabled } from "@/server/paypal/config";
import { privateJson } from "@/server/auth/http";
export const runtime = "nodejs";
export async function GET() {
  try {
    return privateJson({
      enabled:
        paypalEnabled() &&
        !!(await getDatabase()
          .payPalSetting.findFirst({
            where: { id: "site" },
            select: {
              activeMerchant: {
                select: { reportingEnabled: true, transferRecipient: true },
              },
            },
          })
          .then(
            (s) =>
              s?.activeMerchant.reportingEnabled &&
              !!s.activeMerchant.transferRecipient,
          )),
      method: "REFERENCE",
      environment: "sandbox",
    });
  } catch {
    return privateJson({ enabled: false, environment: "sandbox" });
  }
}
