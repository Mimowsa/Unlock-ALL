import { scheduleEmailJobs } from "@/server/email/schedule";
import { getDatabase } from "@/server/db/client";
import {
  jsonInput,
  privateJson,
  authError,
  clientIdentifier,
} from "@/server/auth/http";
import { consumeRateLimit, AuthFailure } from "@/server/auth/rate-limit";
import { resetRequestSchema } from "@/validation/auth";
import { requestPasswordReset } from "@/server/auth/reset-delivery";
export const runtime = "nodejs";
export async function POST(request: Request) {
  try {
    const db = getDatabase();
    const input = await jsonInput(request);
    await consumeRateLimit(
      db,
      "reset-request-network",
      clientIdentifier(request.headers),
      10,
      3600,
    );
    const parsed = resetRequestSchema.safeParse(input);
    if (!parsed.success) throw new AuthFailure("invalidInput");
    await consumeRateLimit(
      db,
      "reset-request-account",
      parsed.data.email,
      3,
      3600,
    );
    const result = await requestPasswordReset(
      db,
      parsed.data.email,
      parsed.data.locale,
    );
    scheduleEmailJobs();
    return privateJson(result);
  } catch (error) {
    return authError(error);
  }
}
