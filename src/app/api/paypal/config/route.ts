import { getDatabase } from "@/server/db/client";
import { paypalEnabled } from "@/server/paypal/config";
import { privateJson } from "@/server/auth/http";
export const runtime = "nodejs";
export async function GET() {
  try {
    return privateJson({
      enabled:
        paypalEnabled() &&
        !!(await getDatabase().payPalSetting.findUnique({
          where: { id: "site" },
          select: { id: true },
        })),
      environment: "sandbox",
    });
  } catch {
    return privateJson({ enabled: false, environment: "sandbox" });
  }
}
