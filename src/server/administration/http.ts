import "server-only";
import { currentUser } from "../auth/current-user";
import { AuthFailure } from "../auth/rate-limit";
import { privateJson } from "../auth/http";
import { CommerceFailure } from "../commerce/inventory";
import { CatalogFailure } from "../catalog/service";
export async function administrator() {
  const user = await currentUser();
  if (!user) throw new CatalogFailure("forbidden", 401);
  if (user.role !== "ADMIN") throw new CatalogFailure("forbidden", 403);
  return user;
}
export function catalogError(error: unknown) {
  if (
    error instanceof CatalogFailure ||
    error instanceof AuthFailure ||
    error instanceof CommerceFailure
  )
    return privateJson({ error: error.code }, error.status);
  const code =
    typeof error === "object" && error
      ? (error as { code?: string }).code
      : undefined;
  if (code === "P2002") return privateJson({ error: "conflict" }, 409);
  // PostgreSQL trigger errors are wrapped by the driver adapter. Never echo SQL,
  // input, credentials or stack traces in an API response or application log.
  if (
    code === "P2004" ||
    (typeof error === "object" &&
      error &&
      String((error as Error).message).includes("last active administrator"))
  )
    return privateJson({ error: "lastAdmin" }, 409);
  console.error("Catalogue or administration operation unavailable.");
  return privateJson({ error: "unavailable" }, 503);
}
