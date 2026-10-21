import { getDatabase } from "@/server/db/client";
import { listKeys, addKey } from "@/server/commerce/inventory";
import { administrator, catalogError } from "@/server/administration/http";
import { privateJson, jsonInput } from "@/server/auth/http";
import { consumeRateLimit } from "@/server/auth/rate-limit";
export const runtime = "nodejs";
export async function GET(request: Request) {
  try {
    await administrator();
    const params = new URL(request.url).searchParams;
    const raw = Number(params.get("page") ?? 1);
    const page =
      Number.isSafeInteger(raw) && raw > 0 ? Math.min(raw, 100000) : 1;
    return privateJson(
      await listKeys(getDatabase(), params.get("productId") ?? "", page),
    );
  } catch (error) {
    return catalogError(error);
  }
}
export async function POST(request: Request) {
  try {
    const actor = await administrator();
    const input = await jsonInput(request);
    const db = getDatabase();
    await consumeRateLimit(db, "inventory-write", actor.id, 100, 900);
    return privateJson(await addKey(db, actor.id, input), 201);
  } catch (error) {
    return catalogError(error);
  }
}
