import { getDatabase } from "@/server/db/client";
import {
  jsonInput,
  privateJson,
  authError,
  clientIdentifier,
} from "@/server/auth/http";
import { consumeRateLimit } from "@/server/auth/rate-limit";
import { resetPassword } from "@/server/auth/service";
export const runtime = "nodejs";
export async function POST(request: Request) {
  try {
    const input = await jsonInput(request);
    const db = getDatabase();
    await consumeRateLimit(
      db,
      "reset-network",
      clientIdentifier(request.headers),
      10,
      900,
    );
    await resetPassword(db, input);
    return privateJson({ reset: true });
  } catch (error) {
    return authError(error);
  }
}
