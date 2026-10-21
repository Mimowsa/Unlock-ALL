import { getDatabase } from "@/server/db/client";
import { saveUser } from "@/server/administration/service";
import { administrator, catalogError } from "@/server/administration/http";
import { jsonInput, privateJson } from "@/server/auth/http";
import { consumeRateLimit } from "@/server/auth/rate-limit";
export const runtime = "nodejs";
export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const user = await administrator();
    const input = await jsonInput(request);
    const { id } = await context.params;
    const db = getDatabase();
    await consumeRateLimit(db, "admin-write", user.id, 100, 900);
    await saveUser(db, user.id, id, input);
    return privateJson({ saved: true });
  } catch (error) {
    return catalogError(error);
  }
}
