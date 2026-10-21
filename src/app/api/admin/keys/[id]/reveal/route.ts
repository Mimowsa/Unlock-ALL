import { getDatabase } from "@/server/db/client";
import { revealKey } from "@/server/commerce/inventory";
import { administrator, catalogError } from "@/server/administration/http";
import { privateJson, jsonInput } from "@/server/auth/http";
import { consumeRateLimit } from "@/server/auth/rate-limit";
import { z } from "zod";
export const runtime = "nodejs";
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const actor = await administrator();
    if (
      !z
        .object({})
        .strict()
        .safeParse(await jsonInput(request)).success
    )
      return privateJson({ error: "invalidInput" }, 400);
    const { id } = await params;
    const db = getDatabase();
    await consumeRateLimit(db, "inventory-view", actor.id, 60, 900);
    return privateJson(await revealKey(db, actor.id, id));
  } catch (error) {
    return catalogError(error);
  }
}
