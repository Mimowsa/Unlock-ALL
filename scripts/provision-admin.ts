import nextEnv from "@next/env";
import { createInterface } from "node:readline/promises";
import { Writable } from "node:stream";
import { createDatabaseClient } from "../src/server/db/factory.ts";
import { registrationSchema } from "../src/validation/auth.ts";
import { passwordHash } from "../src/server/auth/password.ts";
nextEnv.loadEnvConfig(process.cwd());
async function readInput() {
let raw: unknown;
if (process.stdin.isTTY) {
  let muted = false;
  const output = new Writable({
    write(chunk, _encoding, callback) {
      if (!muted) process.stdout.write(chunk);
      callback();
    },
  });
  const prompt = createInterface({
    input: process.stdin,
    output,
    terminal: true,
  });
  try {
    const email = await prompt.question("Email administrateur : ");
    const nickname = await prompt.question("Pseudonyme : ");
    process.stdout.write(
      "Mot de passe (15 à 128 caractères, saisie masquée) : ",
    );
    muted = true;
    const password = await prompt.question("");
    muted = false;
    process.stdout.write("\n");
    raw = { email, nickname, password };
  } finally {
    prompt.close();
  }
} else {
  // Automation may supply one JSON object on stdin, never via shell arguments.
  const parts: Buffer[] = [];
  let size = 0;
  for await (const chunk of process.stdin) {
    const b = Buffer.from(chunk);
    size += b.length;
    if (size > 4096) throw new Error("Input too large.");
    parts.push(b);
  }
  raw = JSON.parse(Buffer.concat(parts).toString("utf8"));
}
return raw;
}
let raw: unknown;
try {raw = await readInput();} catch {console.error("Invalid or interrupted input. Nothing changed; no credentials logged."); process.exit(1);}
const parsed = registrationSchema.safeParse(raw);
if (!parsed.success || !process.env.DIRECT_URL) {
  console.error("Invalid input or missing DIRECT_URL. Nothing changed.");
  process.exit(1);
}
const db = createDatabaseClient(process.env.DIRECT_URL);
try {
  const encoded = await passwordHash(parsed.data.password);
  await db.$transaction(async (tx) => {
    const existing = await tx.user.findUnique({
      where: { email: parsed.data.email },
    });
    if (existing && !existing.isDemo)
      throw new Error(
        "Existing non-demo account must not be overwritten by bootstrap.",
      );
    const user = await tx.user.upsert({
      where: { email: parsed.data.email },
      update: {
        name: parsed.data.nickname,
        passwordHash: encoded,
        active: true,
        isDemo: false,
        role: "ADMIN",
      },
      create: {
        email: parsed.data.email,
        name: parsed.data.nickname,
        passwordHash: encoded,
        role: "ADMIN",
        active: true,
        isDemo: false,
      },
    });
    await tx.auditLog.create({
      data: {
        actorId: user.id,
        action: "ADMIN_BOOTSTRAPPED_BY_LOCAL_OPERATOR",
        entityType: "User",
        entityId: user.id,
      },
    });
  });
  console.log(
    "Administrator provisioned. No password printed or saved in a file.",
  );
} catch {
  console.error(
    "Administrator provisioning refused or unavailable. No existing real account was overwritten.",
  );
  process.exitCode = 1;
} finally {
  await db.$disconnect();
}
