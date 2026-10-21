import "server-only";
import { currentUser } from "../auth/current-user";
import { CommerceFailure } from "./inventory";
export async function orderCustomer() {
  const user = await currentUser();
  if (!user) throw new CommerceFailure("forbidden", 401);
  return user;
}
export function orderPage(request: Request) {
  const params = new URL(request.url).searchParams;
  const raw = Number(params.get("page") ?? 1);
  return {
    page: Number.isSafeInteger(raw) && raw > 0 ? Math.min(raw, 100000) : 1,
    q: (params.get("q") ?? "").slice(0, 254),
    status:
      params.get("status") === "completed"
        ? ("completed" as const)
        : params.get("status") === "failed"
          ? ("failed" as const)
          : ("" as const),
  };
}
