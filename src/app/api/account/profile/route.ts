import { currentUser } from "@/server/auth/current-user";
import { getDatabase } from "@/server/db/client";
import { privateJson, jsonInput, authError } from "@/server/auth/http";
import { updateProfile } from "@/server/auth/service";
import { consumeRateLimit } from "@/server/auth/rate-limit";
export const runtime = "nodejs";
export async function GET() {
  try {
    const user = await currentUser();
    return user
      ? privateJson({ user })
      : privateJson({ error: "invalidCredentials" }, 401);
  } catch (error) {
    return authError(error);
  }
}
export async function PATCH(request: Request) {
  try {
    const input = await jsonInput(request);
    const user = await currentUser();
    if (!user) return privateJson({ error: "invalidCredentials" }, 401);
    const db = getDatabase();
    await consumeRateLimit(db, "profile", user.id, 30, 900);
    await updateProfile(db, user.id, input);
    return privateJson({ saved: true });
  } catch (error) {
    return authError(error);
  }
}
