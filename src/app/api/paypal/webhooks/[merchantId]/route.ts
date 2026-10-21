import { CommerceFailure } from "@/server/commerce/inventory";
import { getDatabase } from "@/server/db/client";
import { processPayPalWebhook } from "@/server/paypal/webhook";
import { limitedBody, privateJson } from "@/server/auth/http";
import { catalogError } from "@/server/administration/http";
import { scheduleEmailJobs } from "@/server/email/schedule";
export const runtime = "nodejs";
export const maxDuration = 60;
export async function POST(
  request: Request,
  { params }: { params: Promise<{ merchantId: string }> },
) {
  try {
    if (
      !request.headers
        .get("content-type")
        ?.toLowerCase()
        .startsWith("application/json")
    )
      throw new CommerceFailure("invalidInput", 415);
    const source = await limitedBody(request, 65536);
    let raw: unknown;
    try {
      raw = JSON.parse(source);
    } catch (e) {
      if (e instanceof CommerceFailure) throw e;
      throw new CommerceFailure("invalidInput", 400);
    }
    const result = await processPayPalWebhook(
      getDatabase(),
      (await params).merchantId,
      request.headers,
      raw,
    );
    scheduleEmailJobs();
    return privateJson(result);
  } catch (error) {
    return catalogError(error);
  }
}
