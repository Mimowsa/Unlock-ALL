export function assertDemoSeedAllowed(
  env: Readonly<Record<string, string | undefined>> = process.env,
) {
  if (
    env.APP_MODE !== "demo" ||
    env.DEMO_SEED_ENABLED !== "true" ||
    env.NODE_ENV === "production" ||
    env.VERCEL_ENV === "production"
  )
    throw new Error(
      "Demo seed refused. Requires APP_MODE=demo and DEMO_SEED_ENABLED=true outside production.",
    );
}
