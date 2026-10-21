import nextEnv from "@next/env";
import { readFile, writeFile, chmod } from "node:fs/promises";
import { emailConfig } from "../src/server/email/config.ts";
nextEnv.loadEnvConfig(process.cwd());
try {
  const recipient = process.argv
    .find((arg) => arg.startsWith("--recipient="))
    ?.slice("--recipient=".length)
    ?.trim()
    .toLowerCase();
  const origin = new URL(process.env.NEXTAUTH_URL || "http://127.0.0.1:3000");
  if (
    process.env.NODE_ENV === "production" ||
    process.env.VERCEL ||
    process.env.APP_MODE !== "demo" ||
    !["localhost", "127.0.0.1", "[::1]"].includes(origin.hostname)
  )
    throw new Error("Local only");
  const values = {
    EMAIL_DELIVERY: "resend-test",
    EMAIL_TEST_RECIPIENT: recipient,
    AUTH_RESET_DELIVERY: "email",
  };
  if (!emailConfig({ ...process.env, ...values }))
    throw new Error("Invalid configuration");
  let source = await readFile(".env", "utf8");
  for (const [name, value] of Object.entries(values)) {
    const pattern = new RegExp(`^${name}=.*$`, "m");
    source = pattern.test(source)
      ? source.replace(pattern, `${name}=${value}`)
      : source + `\n${name}=${value}\n`;
  }
  await writeFile(".env", source, { mode: 0o600 });
  await chmod(".env", 0o600);
  console.log(
    "Test email delivery configured. Only the authorized recipient can receive email. API key was not displayed.",
  );
} catch {
  console.error(
    "Email configuration unavailable. Check APP_MODE=demo, local origin, private API key and --recipient=email. No secrets logged.",
  );
  process.exitCode = 1;
}
