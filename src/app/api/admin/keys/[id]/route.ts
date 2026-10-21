import { getDatabase } from "@/server/db/client";
import { changeKey } from "@/server/commerce/inventory";
import { administrator, catalogError } from "@/server/administration/http";
import { privateJson, jsonInput } from "@/server/auth/http";
import { consumeRateLimit } from "@/server/auth/rate-limit";
export const runtime = "nodejs";
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const actor = await administrator();
    const input = await jsonInput(request);
    const { id } = await params;
    const db = getDatabase();
    await consumeRateLimit(db, "inventory-write", actor.id, 100, 900);
    await changeKey(db, actor.id, id, input);
    return privateJson({ saved: true });
  } catch (error) {
    return catalogError(error);
  }
}
