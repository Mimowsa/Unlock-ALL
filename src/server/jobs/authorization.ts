import { timingSafeEqual } from "node:crypto";
type Env = Readonly<Record<string, string | undefined>>;
export function jobAuthorization(
  request: Request,
  env: Env = process.env,
): 200 | 401 | 503 {
  const secret = env.CRON_SECRET;
  if (
    env.BACKGROUND_JOBS_ENABLED !== "true" ||
    !secret ||
    !/^[A-Za-z0-9_-]{32,256}$/.test(secret)
  )
    return 503;
  const provided = request.headers.get("authorization") ?? "";
  const expected = `Bearer ${secret}`;
  return Buffer.byteLength(provided) === Buffer.byteLength(expected) &&
    timingSafeEqual(Buffer.from(provided), Buffer.from(expected))
    ? 200
    : 401;
}
