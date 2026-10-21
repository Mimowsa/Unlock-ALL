import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, appendFileSync, chmodSync } from "node:fs";
const file = ".env";
const existing = existsSync(file) ? readFileSync(file, "utf8") : "";
const additions = {
  NEXTAUTH_URL: "http://127.0.0.1:3000",
  NEXTAUTH_SECRET: randomBytes(48).toString("hex"),
  AUTH_RESET_DELIVERY: "local",
};
let count = 0;
for (const [key, value] of Object.entries(additions)) {
  if (
    process.env[key] ||
    new RegExp(`^\\s*(?:export\\s+)?${key}\\s*=`, "m").test(existing)
  )
    continue;
  appendFileSync(file, `\n${key}=${value}\n`, { mode: 0o600 });
  count++;
}
chmodSync(file, 0o600);
console.log(
  `Authentication configuration ready (${count} missing settings added). Secrets are not printed. Restart the development server if it was already running.`,
);
