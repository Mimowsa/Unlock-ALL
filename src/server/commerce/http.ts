import "server-only";
import { cookies } from "next/headers";
import { currentUser } from "../auth/current-user";
import { getDatabase } from "../db/client";
import { authOrigin } from "../auth/config";
import {
  newGuestToken,
  guestHash,
  GUEST_CART_SECONDS,
  type CartOwner,
} from "./cart";
import type { NextResponse } from "next/server";
export const CART_COOKIE = "unlock-all.cart";
export async function cartIdentity() {
  const user = await currentUser();
  const raw = (await cookies()).get(CART_COOKIE)?.value;
  const token = raw && /^[a-f0-9]{64}$/.test(raw) ? raw : undefined;
  if (user)
    return {
      owner: { userId: user.id } as CartOwner,
      user,
      guestToken: token,
      newToken: undefined,
    };
  if (token) {
    const cart = await getDatabase().cart.findUnique({
      where: { guestTokenHash: guestHash(token) },
      select: { expiresAt: true },
    });
    if (cart?.expiresAt && cart.expiresAt > new Date())
      return {
        owner: { guestToken: token } as CartOwner,
        user: null,
        guestToken: token,
        newToken: undefined,
      };
  }
  const generated = newGuestToken();
  return {
    owner: { guestToken: generated } as CartOwner,
    user: null,
    guestToken: generated,
    newToken: generated,
  };
}
export function cartCookie(
  response: NextResponse,
  token?: string,
  remove = false,
) {
  if (token || remove)
    response.cookies.set(CART_COOKIE, token ?? "", {
      httpOnly: true,
      sameSite: "lax",
      secure: authOrigin().startsWith("https:"),
      path: "/",
      maxAge: remove ? 0 : GUEST_CART_SECONDS,
    });
  return response;
}
