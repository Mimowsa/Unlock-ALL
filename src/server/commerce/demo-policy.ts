import { CommerceFailure } from "./inventory.ts";
export function assertDemoCheckout(
  enabled: boolean,
  env: Readonly<Record<string, string | undefined>> = process.env,
) {
  if (
    env.APP_MODE !== "demo" ||
    env.DEMO_CHECKOUT_ENABLED !== "true" ||
    !enabled
  )
    throw new CommerceFailure("demoDisabled", 403);
}
