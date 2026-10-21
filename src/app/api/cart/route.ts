import { cartIdentity, cartCookie } from "@/server/commerce/http";
import { readCart, mutateCart } from "@/server/commerce/cart";
import { getDatabase } from "@/server/db/client";
import { privateJson, jsonInput, clientIdentifier } from "@/server/auth/http";
import { consumeRateLimit } from "@/server/auth/rate-limit";
import { catalogError } from "@/server/administration/http";
export const runtime = "nodejs";
export async function GET(request: Request) {
  try {
    const identity = await cartIdentity();
    const db = getDatabase();
    if (identity.newToken)
      await consumeRateLimit(
        db,
        "guest-cart-create",
        clientIdentifier(request.headers),
        60,
        3600,
      );
    return cartCookie(
      privateJson(await readCart(db, identity.owner)),
      identity.newToken,
    );
  } catch (error) {
    return catalogError(error);
  }
}
export async function POST(request: Request) {
  try {
    const input = await jsonInput(request);
    const identity = await cartIdentity();
    const db = getDatabase();
    await consumeRateLimit(
      db,
      "cart-write",
      identity.user?.id ?? clientIdentifier(request.headers),
      120,
      900,
    );
    return cartCookie(
      privateJson(await mutateCart(db, identity.owner, input)),
      identity.newToken,
    );
  } catch (error) {
    return catalogError(error);
  }
}
