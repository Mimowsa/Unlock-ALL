import { expect } from "@playwright/test";
import {
  test,
  loginProfile,
  registerApi,
  browserDatabase,
  origin,
  testPassword,
} from "./browser-helpers";
import { createResetToken } from "../src/server/auth/service";
import { randomUUID } from "node:crypto";

test("protected routes reject guests and local-storage administrator impersonation", async ({
  page,
  request,
}) => {
  // App Router can stream a redirect with HTTP 200 after its loading boundary.
  await page.goto("/fr/admin");
  await expect(page).toHaveURL(/\/fr\/connexion/);
  expect((await request.get(origin + "/api/account/profile")).status()).toBe(
    401,
  );
  await loginProfile(page);
  await page.goto("/fr");
  await expect(page.locator(".product-card")).toHaveCount(12);
  await page.evaluate(() => {
    const state = JSON.parse(localStorage.getItem("unlock-all:demo:v1")!);
    state.currentUserId = "demo-admin";
    localStorage.setItem("unlock-all:demo:v1", JSON.stringify(state));
  });
  await page.goto("/fr/admin");
  await expect(page).toHaveURL(/\/fr\/compte/);
  await expect(
    page.getByRole("link", { name: "Administration", exact: true }),
  ).toHaveCount(0);
});
test("registration rejects privilege fields, cross-origin JSON and weak passwords", async ({
  request,
}) => {
  const email = `validation-${randomUUID()}@example.com`;
  const role = await request.post(origin + "/api/auth/register", {
    headers: { Origin: origin },
    data: { email, password: testPassword, nickname: "Player", role: "ADMIN" },
  });
  expect(role.status()).toBe(400);
  const cross = await request.post(origin + "/api/auth/register", {
    headers: { Origin: "https://attacker.example" },
    data: { email, password: testPassword, nickname: "Player" },
  });
  expect(cross.status()).toBe(403);
  expect((await registerApi(request, email, "short")).status()).toBe(400);
  const db = browserDatabase();
  try {
    expect(await db.user.count({ where: { email } })).toBe(0);
  } finally {
    await db.$disconnect();
  }
});
test("login form verifies the password and sets an HttpOnly session cookie", async ({
  page,
}) => {
  const email = `form-${randomUUID()}@example.com`;
  expect((await registerApi(page.request, email)).status()).toBe(201);
  await page.goto("/en/connexion");
  await page.getByLabel("Email address", { exact: true }).fill(email);
  await page
    .getByLabel("Password", { exact: true })
    .fill("An incorrect long passphrase!");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.locator(".form-error")).toContainText(
    "Invalid credentials",
  );
  await page.getByLabel("Password", { exact: true }).fill(testPassword);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/\/en\/compte$/);
  const cookie = (await page.context().cookies()).find(
    (c) => c.name === "next-auth.session-token",
  )!;
  expect(cookie.httpOnly).toBe(true);
  expect(cookie.sameSite).toBe("Lax");
  const profile = await page.request.get(origin + "/api/account/profile");
  const { user } = await profile.json();
  expect(user.role).toBe("USER");
  expect(user.passwordHash).toBeUndefined();
});
test("logout revokes the session even if its old cookie is replayed", async ({
  page,
}) => {
  await loginProfile(page);
  await page.goto("/fr/compte");
  const cookies = (await page.context().cookies()).filter((c) =>
    c.name.includes("session-token"),
  );
  await page.getByRole("button", { name: "Déconnexion", exact: true }).click();
  await expect(page).toHaveURL(/\/fr\/connexion/);
  expect(
    (await page.request.get(origin + "/api/account/profile")).status(),
  ).toBe(401);
  await page.context().addCookies(cookies);
  expect(
    (await page.request.get(origin + "/api/account/profile")).status(),
  ).toBe(401);
});
test("profile updates are persisted in PostgreSQL and cannot modify roles or email", async ({
  page,
}) => {
  const email = await loginProfile(page);
  await page.goto("/fr/compte");
  await page.getByLabel("Pseudonyme", { exact: true }).fill("Updated Player");
  await page
    .getByLabel("Nom d’utilisateur Discord", { exact: true })
    .fill("updated.player");
  await page.getByRole("button", { name: "Enregistrer", exact: true }).click();
  await expect(page.getByRole("status")).toContainText(
    "Profil enregistré dans PostgreSQL",
  );
  await page.reload();
  await expect(page.getByLabel("Pseudonyme", { exact: true })).toHaveValue(
    "Updated Player",
  );
  const forged = await page.request.patch(origin + "/api/account/profile", {
    headers: { Origin: origin },
    data: { nickname: "Forged", discord: "updated.player", role: "ADMIN" },
  });
  expect(forged.status()).toBe(400);
  const local = await page.evaluate(() => JSON.stringify(localStorage));
  expect(local).not.toContain(email);
  expect(local).not.toContain("Updated Player");
  expect(local).not.toContain("updated.player");
});
test("deactivation invalidates an existing session and protects account pages", async ({
  page,
}) => {
  const email = await loginProfile(page);
  await page.goto("/fr/compte");
  const db = browserDatabase();
  try {
    await db.user.update({ where: { email }, data: { active: false } });
  } finally {
    await db.$disconnect();
  }
  expect(
    (await page.request.get(origin + "/api/account/profile")).status(),
  ).toBe(401);
  await page.goto("/fr/compte");
  await expect(page).toHaveURL(/\/fr\/connexion/);
});
test("password reset changes the password, rejects replay and invalidates prior sessions", async ({
  page,
}) => {
  const email = await loginProfile(page);
  await page.goto("/fr/compte");
  const db = browserDatabase();
  let token: string;
  try {
    token = (await createResetToken(db, email))!.token;
  } finally {
    await db.$disconnect();
  }
  await page.goto("/fr/reinitialiser-mot-de-passe#" + token);
  await page
    .getByLabel("Mot de passe", { exact: true })
    .fill("A newly changed browser passphrase!");
  await page
    .getByLabel("Confirmez le mot de passe", { exact: true })
    .fill("A newly changed browser passphrase!");
  await page
    .getByRole("button", {
      name: "Enregistrer le nouveau mot de passe",
      exact: true,
    })
    .click();
  await expect(page.getByRole("status")).toContainText("Mot de passe modifié");
  expect(
    (await page.request.get(origin + "/api/account/profile")).status(),
  ).toBe(401);
  const replay = await page.request.post(origin + "/api/auth/password/reset", {
    headers: { Origin: origin },
    data: { token, password: testPassword },
  });
  expect(replay.status()).toBe(400);
  expect((await replay.json()).error).toBe("invalidReset");
  await page.goto("/fr/connexion");
  await page.getByLabel("Adresse email", { exact: true }).fill(email);
  await page
    .getByLabel("Mot de passe", { exact: true })
    .fill("A newly changed browser passphrase!");
  await page.getByRole("button", { name: "Connexion", exact: true }).click();
  await expect(page).toHaveURL(/\/fr\/compte$/);
});
test("forgot password does not pretend an email was sent or disclose account existence", async ({
  page,
  request,
}) => {
  const email = await loginProfile(page);
  const known = await request.post(origin + "/api/auth/password/forgot", {
    headers: { Origin: origin },
    data: { email, locale: "FR" },
  });
  const unknown = await request.post(origin + "/api/auth/password/forgot", {
    headers: { Origin: origin },
    data: { email: "missing@example.com", locale: "FR" },
  });
  expect(known.status()).toBe(200);
  expect(await known.json()).toEqual(await unknown.json());
  expect(await known.json()).toEqual({ delivery: "unavailable" });
  await page.goto("/fr/mot-de-passe-oublie");
  await page.getByLabel("Adresse email", { exact: true }).fill(email);
  await page
    .getByRole("button", { name: "Demander un lien", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText(
    "Aucun email n’a été envoyé",
  );
});
test("the login limit persists across requests and cannot be bypassed by forwarded headers", async ({
  request,
}) => {
  const email = `limit-${randomUUID()}@example.com`;
  expect((await registerApi(request, email)).status()).toBe(201);
  const { csrfToken } = await (
    await request.get(origin + "/api/auth/csrf")
  ).json();
  for (let i = 0; i < 7; i++) {
    const response = await request.post(
      origin + "/api/auth/callback/credentials",
      {
        headers: { Origin: origin, "X-Forwarded-For": `192.0.2.${i + 1}` },
        form: {
          csrfToken,
          email,
          password: "Wrong long passphrase!",
          json: "true",
        },
      },
    );
    expect((await response.json()).url).toContain("error");
  }
  const blocked = await request.post(
    origin + "/api/auth/callback/credentials",
    {
      headers: { Origin: origin },
      form: { csrfToken, email, password: testPassword, json: "true" },
    },
  );
  expect((await blocked.json()).url).toContain("error");
  expect((await request.get(origin + "/api/account/profile")).status()).toBe(
    401,
  );
});

test("credentials cannot create a session without the Auth.js CSRF token", async ({
  request,
}) => {
  const email = `csrf-${randomUUID()}@example.com`;
  expect((await registerApi(request, email)).status()).toBe(201);
  await request.post(origin + "/api/auth/callback/credentials", {
    headers: { Origin: origin },
    form: { email, password: testPassword, json: "true" },
  });
  expect((await request.get(origin + "/api/account/profile")).status()).toBe(
    401,
  );
  const db = browserDatabase();
  try {
    const user = await db.user.findUniqueOrThrow({ where: { email } });
    expect(await db.session.count({ where: { userId: user.id } })).toBe(0);
  } finally {
    await db.$disconnect();
  }
});
