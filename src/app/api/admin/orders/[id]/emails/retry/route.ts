import { getDatabase } from "@/server/db/client";
import { administrator, catalogError } from "@/server/administration/http";
import { jsonInput, privateJson } from "@/server/auth/http";
import { CommerceFailure } from "@/server/commerce/inventory";
import { consumeRateLimit } from "@/server/auth/rate-limit";
import { retryOrderEmails } from "@/server/email/retry";
import { scheduleEmailJobs } from "@/server/email/schedule";
export const runtime = "nodejs";
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const actor = await administrator();
    const input = await jsonInput(request);
    if (
      !input ||
      typeof input !== "object" ||
      Array.isArray(input) ||
      Object.keys(input).length
    )
      throw new CommerceFailure("invalidInput");
    const db = getDatabase();
    await consumeRateLimit(db, "email-order-retry", actor.id, 10, 900);
    const { id } = await params,
      result = await retryOrderEmails(db, actor.id, id);
    scheduleEmailJobs();
    return privateJson(result);
  } catch (error) {
    return catalogError(error);
  }
}
