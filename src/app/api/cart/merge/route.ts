import { cartIdentity, cartCookie } from "@/server/commerce/http";
import { mergeGuestCart } from "@/server/commerce/cart";
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
    const identity = await cartIdentity();
    if (!identity.user) return privateJson({ error: "forbidden" }, 401);
    const db = getDatabase();
    if (identity.guestToken)
      await consumeRateLimit(db, "cart-merge", identity.user.id, 30, 900);
    return cartCookie(
      privateJson(
        await mergeGuestCart(db, identity.user.id, identity.guestToken),
      ),
      undefined,
      true,
    );
  } catch (error) {
    return catalogError(error);
  }
}
