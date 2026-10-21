import { keyVaultConfig } from "../security/key-vault.ts";
import { emailConfig } from "../email/config.ts";
type Env = Readonly<Record<string, string | undefined>>;
export function hostedDatabaseUrls(env: Env) {
  const pooled = new URL(env.DATABASE_URL ?? "");
  const direct = new URL(env.DIRECT_URL ?? "");
  for (const url of [pooled, direct]) {
    if (
      !["postgres:", "postgresql:"].includes(url.protocol) ||
      !url.hostname.endsWith(".neon.tech") ||
      !url.username ||
      !url.password ||
      !url.pathname.slice(1) ||
      !["require", "verify-full"].includes(
        url.searchParams.get("sslmode") ?? "",
      )
    )
      throw new Error("Invalid Neon configuration.");
    if (
      url.searchParams.has("options") ||
      (url.searchParams.get("schema") ?? "public") !== "public"
    )
      throw new Error(
        "Hosted demo requires the public schema without session options.",
      );
  }
  if (
    !pooled.hostname.split(".")[0].endsWith("-pooler") ||
    direct.hostname.split(".")[0].endsWith("-pooler") ||
    pooled.hostname.replace("-pooler.", ".") !== direct.hostname ||
    pooled.pathname !== direct.pathname ||
    pooled.username !== direct.username ||
    pooled.password !== direct.password
  )
    throw new Error("Neon connections must target the same database and role.");
  return { pooled, direct };
}
export function deploymentIssues(env: Env = process.env) {
  const issues: string[] = [];
  if (env.APP_MODE !== "demo")
    issues.push(
      "APP_MODE must be demo; commercial payments are not supported.",
    );
  try {
    hostedDatabaseUrls(env);
  } catch {
    issues.push(
      "DATABASE_URL and DIRECT_URL must target the same Neon database with TLS, pooled/direct respectively.",
    );
  }
  try {
    const url = new URL(env.NEXTAUTH_URL ?? "");
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.pathname !== "/" ||
      url.search ||
      url.hash ||
      ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
    )
      throw new Error();
  } catch {
    issues.push("NEXTAUTH_URL must be the canonical public HTTPS origin.");
  }
  const auth = env.NEXTAUTH_SECRET;
  if (!auth || auth.length < 64 || /REPLACE|CHANGE|EXAMPLE/i.test(auth))
    issues.push(
      "NEXTAUTH_SECRET must be a private random secret of at least 64 characters.",
    );
  try {
    keyVaultConfig(env);
  } catch {
    issues.push("Activation-key encryption settings are missing or invalid.");
  }
  const secrets = [
    auth,
    env.ACTIVATION_KEY_ENCRYPTION_KEY,
    env.ACTIVATION_KEY_FINGERPRINT_SECRET,
    env.CRON_SECRET,
  ].filter(Boolean);
  if (new Set(secrets).size !== secrets.length)
    issues.push(
      "Authentication, cron and encryption secrets must be independent.",
    );
  if (
    env.PRODUCT_IMAGE_STORAGE !== "vercel-blob" ||
    !env.BLOB_READ_WRITE_TOKEN ||
    !/^vercel_blob_rw_[A-Za-z0-9_]+$/.test(env.BLOB_READ_WRITE_TOKEN)
  )
    issues.push(
      "Configure a private Vercel Blob store and its server-only read/write token.",
    );
  if (
    env.AUTH_RESET_DELIVERY === "local" ||
    !["none", "email"].includes(env.AUTH_RESET_DELIVERY ?? "none")
  )
    issues.push("Local password-reset files are unavailable on Vercel.");
  if (
    !["none", "resend-test"].includes(env.EMAIL_DELIVERY ?? "none") ||
    (env.EMAIL_DELIVERY === "resend-test" && !emailConfig(env)) ||
    (env.AUTH_RESET_DELIVERY === "email" && !emailConfig(env))
  )
    issues.push(
      "Email configuration must be disabled or valid Resend test delivery.",
    );
  if (env.PAYPAL_ENV !== "sandbox") issues.push("PAYPAL_ENV must be sandbox.");
  if (env.DEMO_SEED_ENABLED === "true")
    issues.push(
      "DEMO_SEED_ENABLED must be false on the hosted runtime; bootstrap separately.",
    );
  if (
    env.BACKGROUND_JOBS_ENABLED !== "true" ||
    !/^[A-Za-z0-9_-]{32,256}$/.test(env.CRON_SECRET ?? "") ||
    !["external", "vercel-pro"].includes(env.SCHEDULER_MODE ?? "")
  )
    issues.push(
      "Configure authenticated background jobs and a scheduler running every minute.",
    );
  return issues;
}
