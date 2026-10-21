import NextAuth from "next-auth";
import { NextRequest } from "next/server";
import { authOptions } from "@/server/auth/options";
import { assertSameOrigin, limitedBody, authError } from "@/server/auth/http";
import { authSecret, authOrigin } from "@/server/auth/config";
export const runtime = "nodejs";
type Context = { params: Promise<{ nextauth: string[] }> };
const handler = NextAuth(authOptions);
export async function GET(request: NextRequest, context: Context) {
  try {
    authSecret();
    authOrigin();
    const response = await handler(request, context);
    response.headers.set("Cache-Control", "no-store");
    return response;
  } catch (error) {
    return authError(error);
  }
}
export async function POST(request: NextRequest, context: Context) {
  try {
    authSecret();
    authOrigin();
    assertSameOrigin(request);
    const body = await limitedBody(request);
    const bounded = new NextRequest(request.url, {
      method: "POST",
      headers: request.headers,
      body,
    });
    const response = await handler(bounded, context);
    response.headers.set("Cache-Control", "no-store");
    return response;
  } catch (error) {
    return authError(error);
  }
}
