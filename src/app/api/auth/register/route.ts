import { scheduleEmailJobs } from "@/server/email/schedule";
import { getDatabase } from "@/server/db/client";
import { registerUser } from "@/server/auth/service";
import {
  jsonInput,
  privateJson,
  authError,
  clientIdentifier,
} from "@/server/auth/http";
export const runtime = "nodejs";
export async function POST(request: Request) {
  try {
    const user = await registerUser(
      getDatabase(),
      await jsonInput(request),
      clientIdentifier(request.headers),
    );
    scheduleEmailJobs(user.id);
    return privateJson(
      { created: true, userId: user.id, emailSent: false },
      201,
    );
  } catch (error) {
    return authError(error);
  }
}
