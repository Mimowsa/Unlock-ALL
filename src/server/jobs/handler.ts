import { jobAuthorization } from "./authorization.ts";
export async function handleJob(request: Request, run: () => Promise<unknown>) {
  const status = jobAuthorization(request);
  const headers = { "Cache-Control": "no-store" };
  if (status !== 200)
    return Response.json(
      { error: status === 401 ? "unauthorized" : "disabled" },
      { status, headers },
    );
  try {
    return Response.json(await run(), { headers });
  } catch {
    console.error("Background job unavailable; pending work retained.");
    return Response.json({ error: "unavailable" }, { status: 503, headers });
  }
}
