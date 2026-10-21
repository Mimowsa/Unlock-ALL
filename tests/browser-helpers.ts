import {
  expect,
  type Page,
  type APIRequestContext,
  test as base,
} from "@playwright/test";
import { randomUUID } from "node:crypto";
import { createDatabaseClient } from "../src/server/db/factory.ts";
import { passwordHash } from "../src/server/auth/password.ts";
export const origin = "http://127.0.0.1:3100";
export const testPassword = "Browser demo passphrase 2026!";
export function browserDatabase() {
  const url = process.env.DATABASE_URL;
  if (
    process.env.UNLOCK_ALL_E2E !== "true" ||
    !url ||
    !new URL(url).searchParams.get("schema")?.startsWith("unlock_all_e2e_")
  )
    throw new Error("Use npm run test:e2e to isolate browser tests.");
  return createDatabaseClient(url);
}
export const test = base.extend<{ authSafety: void }>({
  authSafety: [
    async ({}, use) => {
      const db = browserDatabase();
      try {
        await db.authRateLimit.deleteMany();
      } finally {
        await db.$disconnect();
      }
      await use();
    },
    { auto: true },
  ],
});
export async function loginProfile(page: Page, admin = false) {
  const db = browserDatabase();
  const email = `browser-${randomUUID()}@example.com`;
  try {
    await db.user.create({
      data: {
        email,
        name: admin ? "Browser Admin" : "Browser Player",
        passwordHash: await passwordHash(testPassword),
        role: admin ? "ADMIN" : "USER",
        active: true,
        isDemo: false,
      },
    });
  } finally {
    await db.$disconnect();
  }
  const response = await page.request.get(origin + "/api/auth/csrf");
  const { csrfToken } = await response.json();
  const result = await page.request.post(
    origin + "/api/auth/callback/credentials",
    {
      headers: { Origin: origin },
      form: {
        csrfToken,
        email,
        password: testPassword,
        json: "true",
        callbackUrl: origin + (admin ? "/fr/admin" : "/fr/compte"),
      },
    },
  );
  expect(result.ok()).toBe(true);
  expect((await result.json()).url).not.toContain("error");
  return email;
}
export async function registerApi(
  request: APIRequestContext,
  email: string,
  password = testPassword,
) {
  return request.post(origin + "/api/auth/register", {
    headers: { Origin: origin },
    data: { email, password, nickname: "Browser Player", locale: "FR" },
  });
}
