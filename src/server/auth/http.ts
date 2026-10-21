import { NextResponse } from "next/server";
import { authOrigin } from "./config";
import { AuthFailure } from "./rate-limit";
export function clientIdentifier(
  headers: Headers | Record<string, string | string[] | undefined> | undefined,
) {
  // Vercel overwrites the forwarding header at its trusted edge. Outside that
  // environment, caller-provided forwarding headers never bypass the limiter.
  if (process.env.VERCEL !== "1") return "local-or-untrusted-proxy";
  const raw =
    headers instanceof Headers
      ? headers.get("x-forwarded-for")
      : headers?.["x-forwarded-for"];
  return (typeof raw === "string" ? raw.split(",")[0].trim() : "") || "unknown";
}
export function assertSameOrigin(request: Request) {
  if (request.headers.get("origin") !== authOrigin())
    throw new AuthFailure("invalidInput", 403);
}
export async function limitedBody(request: Request, max = 8192) {
  const reader = request.body?.getReader();
  let size = 0;
  const parts: Uint8Array[] = [];
  if (reader)
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > max) {
          await reader.cancel();
          throw new AuthFailure("invalidInput", 413);
        }
        parts.push(value);
      }
    } finally {
      reader.releaseLock();
    }
  return Buffer.concat(parts).toString("utf8");
}
export async function jsonInput(request: Request, max = 8192) {
  assertSameOrigin(request);
  if (
    !request.headers
      .get("content-type")
      ?.toLowerCase()
      .startsWith("application/json")
  )
    throw new AuthFailure("invalidInput", 415);
  try {
    return JSON.parse(await limitedBody(request, max)) as unknown;
  } catch (e) {
    if (e instanceof AuthFailure) throw e;
    throw new AuthFailure("invalidInput");
  }
}
export function privateJson(value: unknown, status = 200) {
  return NextResponse.json(value, {
    status,
    headers: { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" },
  });
}
export function authError(error: unknown) {
  if (error instanceof AuthFailure)
    return privateJson({ error: error.code }, error.status);
  console.error("Authentication operation unavailable.");
  return privateJson({ error: "unavailable" }, 503);
}
