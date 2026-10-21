import { currentUser } from "@/server/auth/current-user";
import { validateCart } from "@/server/commerce/cart";
import { getDatabase } from "@/server/db/client";
import { privateJson, jsonInput } from "@/server/auth/http";
import { consumeRateLimit } from "@/server/auth/rate-limit";
import { catalogError } from "@/server/administration/http";
import { z } from "zod";
export const runtime = "nodejs";
export async function POST(request: Request) {
  try {
    if (
      !z
        .object({})
        .strict()
        .safeParse(await jsonInput(request)).success
    )
      return privateJson({ error: "invalidInput" }, 400);
    const user = await currentUser();
    if (!user) return privateJson({ error: "forbidden" }, 401);
    const db = getDatabase();
    await consumeRateLimit(db, "cart-validate", user.id, 30, 900);
    return privateJson(await validateCart(db, user.id));
  } catch (error) {
    return catalogError(error);
  }
}
