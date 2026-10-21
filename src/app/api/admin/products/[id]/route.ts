import { getDatabase } from "@/server/db/client";
import { saveProduct } from "@/server/catalog/service";
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
    const input = await jsonInput(request, 32768);
    const { id } = await context.params;
    const db = getDatabase();
    await consumeRateLimit(db, "admin-write", user.id, 100, 900);
    return privateJson({ product: await saveProduct(db, user.id, input, id) });
  } catch (error) {
    return catalogError(error);
  }
}
