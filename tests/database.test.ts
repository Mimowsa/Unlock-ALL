import { AuthFailure } from "../src/server/auth/rate-limit.ts";
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import nextEnv from "@next/env";
import pg, { type Client } from "pg";
import { createDatabaseClient } from "../src/server/db/factory.ts";
import {
  sealKey,
  type KeyVaultConfig,
} from "../src/server/security/key-vault.ts";
import { seedDemo } from "../prisma/seed.ts";
nextEnv.loadEnvConfig(process.cwd());
// Tests must never send real emails, even with a configured local account.
process.env.EMAIL_DELIVERY = "none";

const connectionString =
  process.env.TEST_DATABASE_URL || process.env.DIRECT_URL;
if (!connectionString)
  throw new Error(
    "TEST_DATABASE_URL or DIRECT_URL is required for the database tests.",
  );
if (
  process.env.NODE_ENV === "production" ||
  process.env.VERCEL_ENV === "production"
)
  throw new Error("Database tests cannot run in production.");
const schema = `unlock_all_test_${randomBytes(6).toString("hex")}`;
const vault: KeyVaultConfig = {
  encryptionKey: randomBytes(32),
  fingerprintSecret: randomBytes(32),
  keyId: "test-v1",
};
let admin: Client;
async function client() {
  const c = new pg.Client({ connectionString });
  await c.connect();
  await c.query(`SET search_path TO "${schema}"`);
  return c;
}
async function rollbackTest(fn: (c: Client) => Promise<void>) {
  const c = await client();
  await c.query("BEGIN");
  try {
    await fn(c);
  } finally {
    await c.query("ROLLBACK");
    await c.end();
  }
}
async function sqlError(c: Client, code: string, fn: () => Promise<unknown>) {
  await c.query("SAVEPOINT expected_error");
  try {
    await assert.rejects(fn, (e: unknown) => {
      assert.equal((e as { code: string }).code, code);
      return true;
    });
  } finally {
    await c.query("ROLLBACK TO SAVEPOINT expected_error");
    await c.query("RELEASE SAVEPOINT expected_error");
  }
}
async function order(c: Client, id = "o1", productId = "p1", quantity = 1) {
  await c.query(
    `INSERT INTO "Order" ("id","reference","userId","idempotencyKey","requestHash","subtotalCents","totalCents","customerEmail","discordUsername","updatedAt") VALUES ($1,$2,'u1',$1,$3,$4,$4,'tester@example.com','player.demo',now())`,
    [id, `REF-${id}`, "a".repeat(64), 2490 * quantity],
  );
  await c.query(
    `INSERT INTO "OrderItem" ("id","orderId","productId","productNameFr","productNameEn","platformName","gameName","unitPriceCents","quantity","lineTotalCents") VALUES ($1,$2,$3,'Nom initial','Original name','PC','Call of Duty',2490,$4,$5)`,
    [`item-${id}`, id, productId, quantity, 2490 * quantity],
  );
  await c.query(`UPDATE "Order" SET "status"='VALIDATED' WHERE "id"=$1`, [id]);
}
async function assign(
  c: Client,
  keyId = "k1",
  orderId = "o1",
  unitIndex = 1,
  productId = "p1",
) {
  return c.query(
    `INSERT INTO "KeyAssignment" ("keyId","productId","orderItemId","unitIndex") VALUES ($1,$2,$3,$4)`,
    [keyId, productId, `item-${orderId}`, unitIndex],
  );
}
before(async () => {
  admin = new pg.Client({ connectionString });
  await admin.connect();
  await admin.query(`CREATE SCHEMA "${schema}"`);
  await admin.query(`SET search_path TO "${schema}"`);
  const folders = (await readdir("prisma/migrations", { withFileTypes: true }))
    .filter((f) => f.isDirectory())
    .map((f) => f.name)
    .sort();
  for (const folder of folders)
    await admin.query(
      await readFile(`prisma/migrations/${folder}/migration.sql`, "utf8"),
    );
  await admin.query(`INSERT INTO "User" ("id","email","updatedAt") VALUES ('u1','tester@example.com',now()),('u2','other@example.com',now());
    INSERT INTO "Category" ("id","slug") VALUES ('c1','test-category');
    INSERT INTO "Game" ("id","slug","name") VALUES ('g1','test-game','Test game');
    INSERT INTO "Platform" ("id","slug","name") VALUES ('plat1','test-pc','PC');
    INSERT INTO "Product" ("id","slug","priceCents","categoryId","gameId","platformId","updatedAt") VALUES ('p1','test-product-1',2490,'c1','g1','plat1',now()),('p2','test-product-2',2490,'c1','g1','plat1',now());`);
  for (const [id, productId] of [
    ["k1", "p1"],
    ["k2", "p1"],
    ["k3", "p2"],
    ["race-key", "p1"],
  ]) {
    const encrypted = sealKey(`DEMO-TEST-${id}`, vault);
    await admin.query(
      `INSERT INTO "ActivationKey" ("id","productId","ciphertext","fingerprint","encryptionKeyId") VALUES ($1,$2,$3,$4,$5)`,
      [
        id,
        productId,
        encrypted.ciphertext,
        encrypted.fingerprint,
        encrypted.encryptionKeyId,
      ],
    );
  }
});
after(async () => {
  if (admin) {
    try {
      await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    } finally {
      await admin.end();
    }
  }
});

test("money, quantities, emails and password hashes are constrained by PostgreSQL", () =>
  rollbackTest(async (c) => {
    await sqlError(c, "23514", () =>
      c.query(`UPDATE "Product" SET "priceCents"=-1 WHERE "id"='p1'`),
    );
    await sqlError(c, "23514", () =>
      c.query(`UPDATE "User" SET "email"='UPPER@example.com' WHERE "id"='u1'`),
    );
    await sqlError(c, "23514", () =>
      c.query(`UPDATE "User" SET "passwordHash"='plaintext' WHERE "id"='u1'`),
    );
    await c.query(
      `INSERT INTO "Cart" ("id","userId","updatedAt") VALUES ('cart1','u1',now())`,
    );
    await sqlError(c, "23514", () =>
      c.query(
        `INSERT INTO "CartItem" ("cartId","productId","quantity") VALUES ('cart1','p1',0)`,
      ),
    );
  }));
test("a key cannot be assigned twice or occupy the same unit slot", () =>
  rollbackTest(async (c) => {
    await order(c);
    await assign(c);
    await sqlError(c, "23505", () => assign(c));
    await sqlError(c, "23505", () => assign(c, "k2"));
    await sqlError(c, "23514", () => assign(c, "k2", "o1", 2));
  }));
test("composite foreign keys prevent allocation to the wrong product", () =>
  rollbackTest(async (c) => {
    await order(c, "o2", "p2");
    await sqlError(c, "23503", () => assign(c, "k1", "o2", 1, "p1"));
    await sqlError(c, "23503", () => assign(c, "k1", "o2", 1, "p2"));
  }));
test("disabled keys and demo keys for commercial orders cannot be allocated", () =>
  rollbackTest(async (c) => {
    await order(c);
    await c.query(
      `UPDATE "ActivationKey" SET "disabledAt"=now() WHERE "id"='k1'`,
    );
    await sqlError(c, "23514", () => assign(c));
    await c.query(
      `INSERT INTO "Order" ("id","reference","userId","idempotencyKey","requestHash","mode","paymentStatus","customerEmail","discordUsername","updatedAt") VALUES ('commercial','COMMERCIAL','u1','commercial',$1,'COMMERCIAL','PENDING','tester@example.com','player.demo',now())`,
      ["c".repeat(64)],
    );
    await c.query(
      `INSERT INTO "OrderItem" ("id","orderId","productId","productNameFr","productNameEn","platformName","gameName","unitPriceCents","quantity","lineTotalCents") VALUES ('item-commercial','commercial','p1','Nom','Name','PC','COD',2490,1,2490)`,
    );
    await c.query(
      `UPDATE "Order" SET "status"='VALIDATED' WHERE "id"='commercial'`,
    );
    await sqlError(c, "23514", () => assign(c, "k2", "commercial"));
  }));
test("completion requires one key per unit and matching totals, enforced at commit", () =>
  rollbackTest(async (c) => {
    await order(c, "o1", "p1", 2);
    await assign(c);
    await sqlError(c, "23514", async () => {
      await c.query(
        `UPDATE "Order" SET "status"='COMPLETED',"completedAt"=now() WHERE "id"='o1'`,
      );
      await c.query("SET CONSTRAINTS ALL IMMEDIATE");
    });
    await assign(c, "k2", "o1", 2);
    await c.query(
      `UPDATE "Order" SET "status"='COMPLETED',"completedAt"=now() WHERE "id"='o1'`,
    );
    await c.query("SET CONSTRAINTS ALL IMMEDIATE");
    assert.equal(
      (await c.query(`SELECT count(*)::int AS count FROM "KeyAssignment"`))
        .rows[0].count,
      2,
    );
  }));
test("product edits preserve order snapshots and delivered keys are immutable", () =>
  rollbackTest(async (c) => {
    await order(c);
    await assign(c);
    await c.query(`UPDATE "Product" SET "priceCents"=9999 WHERE "id"='p1'`);
    assert.equal(
      (
        await c.query(
          `SELECT "unitPriceCents" FROM "OrderItem" WHERE "id"='item-o1'`,
        )
      ).rows[0].unitPriceCents,
      2490,
    );
    await sqlError(c, "23514", () =>
      c.query(
        `UPDATE "OrderItem" SET "productNameFr"='Changed' WHERE "id"='item-o1'`,
      ),
    );
    await sqlError(c, "23514", () =>
      c.query(`UPDATE "ActivationKey" SET "disabledAt"=now() WHERE "id"='k1'`),
    );
    await sqlError(c, "23514", () =>
      c.query(`DELETE FROM "KeyAssignment" WHERE "keyId"='k1'`),
    );
    await sqlError(c, "23514", () =>
      c.query(`UPDATE "KeyAssignment" SET "unitIndex"=2 WHERE "keyId"='k1'`),
    );
  }));
test("idempotency is unique per customer and order identity cannot be rewritten", () =>
  rollbackTest(async (c) => {
    await order(c);
    await sqlError(c, "23505", () =>
      c.query(
        `INSERT INTO "Order" ("id","reference","userId","idempotencyKey","requestHash","customerEmail","discordUsername","updatedAt") VALUES ('duplicate','NEW-REF','u1','o1',$1,'tester@example.com','player.demo',now())`,
        ["d".repeat(64)],
      ),
    );
    await sqlError(c, "23514", () =>
      c.query(`UPDATE "Order" SET "userId"='u2' WHERE "id"='o1'`),
    );
  }));
test("email failure neither changes completion nor creates additional assignments", () =>
  rollbackTest(async (c) => {
    await order(c);
    await assign(c);
    await c.query(
      `UPDATE "Order" SET "status"='COMPLETED',"completedAt"=now() WHERE "id"='o1'`,
    );
    await c.query("SET CONSTRAINTS ALL IMMEDIATE");
    await c.query(
      `INSERT INTO "EmailJob" ("id","idempotencyKey","userId","orderId","kind","recipient","status","lastErrorCode","updatedAt") VALUES ('email1','delivery-o1','u1','o1','KEY_DELIVERY','tester@example.com','FAILED','PROVIDER_UNAVAILABLE',now())`,
    );
    await sqlError(c, "23503", () =>
      c.query(
        `INSERT INTO "EmailJob" ("id","idempotencyKey","userId","orderId","kind","recipient","updatedAt") VALUES ('wrong-user','delivery-wrong','u2','o1','KEY_DELIVERY','other@example.com',now())`,
      ),
    );
    assert.equal(
      (await c.query(`SELECT "status" FROM "Order" WHERE "id"='o1'`)).rows[0]
        .status,
      "COMPLETED",
    );
    assert.equal(
      (await c.query(`SELECT count(*)::int AS count FROM "KeyAssignment"`))
        .rows[0].count,
      1,
    );
  }));
test("two simultaneous claims on the same key have exactly one winner", async () => {
  await order(admin, "race-a");
  await order(admin, "race-b");
  const a = await client();
  const b = await client();
  try {
    await a.query("BEGIN");
    await b.query("BEGIN");
    await assign(a, "race-key", "race-a");
    const second = assign(b, "race-key", "race-b").then(
      () => "allocated",
      (error: { code: string }) => error.code,
    );
    await a.query("COMMIT");
    assert.equal(await second, "23505");
    await b.query("ROLLBACK");
    assert.equal(
      (
        await admin.query(
          `SELECT count(*)::int AS count FROM "KeyAssignment" WHERE "keyId"='race-key'`,
        )
      ).rows[0].count,
      1,
    );
  } finally {
    await a.query("ROLLBACK");
    await b.query("ROLLBACK");
    await a.end();
    await b.end();
  }
});
test("seed is idempotent, preserves edits and disabled inventory, and rejects lost secrets", async () => {
  const url = new URL(connectionString!);
  url.searchParams.set("schema", schema);
  await seedDemo({ connectionString: url.toString(), vault });
  const db = createDatabaseClient(url.toString());
  try {
    const beforeCount = await db.activationKey.count();
    const keyId = "seed-unlock-0-key-0";
    const stored = await db.activationKey.findUniqueOrThrow({
      where: { id: keyId },
    });
    await db.activationKey.update({
      where: { id: keyId },
      data: { disabledAt: new Date() },
    });
    await db.product.update({
      where: { id: "demo-product-unlock-0" },
      data: { priceCents: 2990 },
    });
    await order(admin, "seed-order", "demo-product-unlock-0");
    await assign(
      admin,
      "seed-unlock-0-key-1",
      "seed-order",
      1,
      "demo-product-unlock-0",
    );
    await seedDemo({ connectionString: url.toString(), vault });
    assert.equal(await db.activationKey.count(), beforeCount);
    const after = await db.activationKey.findUniqueOrThrow({
      where: { id: keyId },
    });
    assert.ok(after.disabledAt);
    assert.equal(after.ciphertext, stored.ciphertext);
    assert.equal(
      (
        await db.keyAssignment.findUniqueOrThrow({
          where: { keyId: "seed-unlock-0-key-1" },
        })
      ).orderItemId,
      "item-seed-order",
    );
    assert.equal(
      (
        await db.product.findUniqueOrThrow({
          where: { id: "demo-product-unlock-0" },
        })
      ).priceCents,
      2990,
    );
    assert.equal(
      (await db.user.findUniqueOrThrow({ where: { id: "seed-demo-admin" } }))
        .active,
      false,
    );
    await assert.rejects(() =>
      seedDemo({
        connectionString: url.toString(),
        vault: { ...vault, encryptionKey: randomBytes(32) },
      }),
    );
    assert.equal(await db.activationKey.count(), beforeCount);
  } finally {
    await db.$disconnect();
  }
});

// Authentication uses the same isolated schema as the integrity tests.
function authenticationDatabase() {
  const url = new URL(connectionString!);
  url.searchParams.set("schema", schema);
  return createDatabaseClient(url.toString());
}
const passphrase = "A long authentication test passphrase!";
const authService = await import("../src/server/auth/service.ts");
const { consumeRateLimit } = await import("../src/server/auth/rate-limit.ts");

test("registration normalizes email, hashes passwords and rejects role injection", async () => {
  const db = authenticationDatabase();
  try {
    await assert.rejects(
      () =>
        authService.registerUser(
          db,
          {
            email: "inject@example.com",
            password: passphrase,
            nickname: "Player",
            role: "ADMIN",
          },
          "registration-injection",
        ),
      (error: unknown) => (error as { code: string }).code === "invalidInput",
    );
    const user = await authService.registerUser(
      db,
      {
        email: "  Auth.Player@Example.com ",
        password: passphrase,
        nickname: "Real Player",
      },
      "registration-user",
    );
    assert.equal(user.email, "auth.player@example.com");
    assert.equal(user.role, "USER");
    const stored = await db.user.findUniqueOrThrow({ where: { id: user.id } });
    assert.ok(stored.passwordHash?.startsWith("$argon2id$"));
    assert.notEqual(stored.passwordHash, passphrase);
    assert.equal(stored.isDemo, false);
    assert.equal(
      await authService.authenticate(
        db,
        { email: user.email, password: "Wrong password" },
        "login-test",
      ),
      null,
    );
    assert.ok(
      await authService.authenticate(
        db,
        { email: user.email, password: passphrase },
        "login-test",
      ),
    );
  } finally {
    await db.$disconnect();
  }
});
test("session records support logout, expiry and security-version revocation", async () => {
  const db = authenticationDatabase();
  try {
    const account = await authService.registerUser(
      db,
      {
        email: "session.player@example.com",
        password: passphrase,
        nickname: "Session Player",
      },
      "session-registration",
    );
    const authenticated = (await authService.authenticate(
      db,
      { email: account.email, password: passphrase },
      "session-login",
    ))!;
    const sessionId = await authService.createLoginSession(db, authenticated);
    const token = {
      sub: account.id,
      sessionId,
      sessionVersion: authenticated.sessionVersion,
    };
    const visible = (await authService.sessionUser(db, token))!;
    assert.equal(visible.role, "USER");
    assert.ok(!("passwordHash" in visible));
    await authService.revokeSession(db, sessionId);
    assert.equal(await authService.sessionUser(db, token), null);
    const secondId = await authService.createLoginSession(db, authenticated);
    await db.user.update({
      where: { id: account.id },
      data: { role: "ADMIN" },
    });
    assert.equal(
      await authService.sessionUser(db, { ...token, sessionId: secondId }),
      null,
    );
    const fresh = (await authService.authenticate(
      db,
      { email: account.email, password: passphrase },
      "session-login",
    ))!;
    const thirdId = await authService.createLoginSession(db, fresh);
    assert.equal(
      (
        await authService.sessionUser(db, {
          sub: account.id,
          sessionId: thirdId,
          sessionVersion: fresh.sessionVersion,
        })
      )?.role,
      "ADMIN",
    );
    await db.session.update({
      where: { sessionToken: authService.tokenHash(thirdId) },
      data: { expires: new Date(Date.now() - 1000) },
    });
    assert.equal(
      await authService.sessionUser(db, {
        sub: account.id,
        sessionId: thirdId,
        sessionVersion: fresh.sessionVersion,
      }),
      null,
    );
  } finally {
    await db.$disconnect();
  }
});
test("password reset is single-use under concurrency and revokes all existing sessions", async () => {
  const db = authenticationDatabase();
  try {
    const account = await authService.registerUser(
      db,
      {
        email: "reset.player@example.com",
        password: passphrase,
        nickname: "Reset Player",
      },
      "reset-registration",
    );
    const login = (await authService.authenticate(
      db,
      { email: account.email, password: passphrase },
      "reset-login",
    ))!;
    const sessionId = await authService.createLoginSession(db, login);
    const issued = (await authService.createResetToken(db, account.email))!;
    const stored = await db.passwordResetToken.findUniqueOrThrow({
      where: { id: issued.id },
    });
    assert.notEqual(stored.tokenHash, issued.token);
    const replacement = "A changed secure authentication passphrase!";
    const results = await Promise.allSettled([
      authService.resetPassword(db, {
        token: issued.token,
        password: replacement,
      }),
      authService.resetPassword(db, {
        token: issued.token,
        password: replacement,
      }),
    ]);
    assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
    assert.equal(
      await authService.sessionUser(db, {
        sub: account.id,
        sessionId,
        sessionVersion: login.sessionVersion,
      }),
      null,
    );
    assert.equal(await db.session.count({ where: { userId: account.id } }), 0);
    await assert.rejects(() =>
      authService.resetPassword(db, {
        token: issued.token,
        password: passphrase,
      }),
    );
    assert.equal(
      await authService.authenticate(
        db,
        { email: account.email, password: passphrase },
        "reset-login",
      ),
      null,
    );
    assert.ok(
      await authService.authenticate(
        db,
        { email: account.email, password: replacement },
        "reset-login",
      ),
    );
    const expired = (await authService.createResetToken(db, account.email))!;
    await db.passwordResetToken.update({
      where: { id: expired.id },
      data: {
        createdAt: new Date(Date.now() - 3600000),
        expiresAt: new Date(Date.now() - 1000),
      },
    });
    await assert.rejects(() =>
      authService.resetPassword(db, {
        token: expired.token,
        password: passphrase,
      }),
    );
  } finally {
    await db.$disconnect();
  }
});
test("persistent rate limits are atomic across separate database clients", async () => {
  const db = authenticationDatabase();
  const other = authenticationDatabase();
  try {
    const results = await Promise.allSettled(
      Array.from({ length: 10 }, (_, i) =>
        consumeRateLimit(
          i % 2 ? db : other,
          "atomic-test",
          "test-client",
          3,
          60,
        ),
      ),
    );
    assert.equal(results.filter((r) => r.status === "fulfilled").length, 3);
    assert.equal(results.filter((r) => r.status === "rejected").length, 7);
  } finally {
    await db.$disconnect();
    await other.$disconnect();
  }
});
test("local reset delivery is private, truthful and identical for unknown accounts", async () => {
  const { mkdtemp, readdir, readFile, stat, rm } = await import(
    "node:fs/promises"
  );
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { requestPasswordReset } = await import(
    "../src/server/auth/reset-delivery.ts"
  );
  const directory = await mkdtemp(join(tmpdir(), "unlock-auth-mail-"));
  const saved = {
    NODE_ENV: process.env.NODE_ENV,
    APP_MODE: process.env.APP_MODE,
    AUTH_RESET_DELIVERY: process.env.AUTH_RESET_DELIVERY,
    AUTH_LOCAL_MAILBOX_DIR: process.env.AUTH_LOCAL_MAILBOX_DIR,
  };
  const db = authenticationDatabase();
  try {
    Object.assign(process.env, {
      NODE_ENV: "development",
      APP_MODE: "demo",
      AUTH_RESET_DELIVERY: "local",
      AUTH_LOCAL_MAILBOX_DIR: directory,
    });
    const known = await requestPasswordReset(
      db,
      "reset.player@example.com",
      "FR",
    );
    const unknown = await requestPasswordReset(
      db,
      "not-registered@example.com",
      "FR",
    );
    assert.deepEqual(known, unknown);
    const files = await readdir(directory);
    assert.equal(files.length, 1);
    const file = join(directory, files[0]);
    assert.equal((await stat(file)).mode & 0o777, 0o600);
    const message = JSON.parse(await readFile(file, "utf8"));
    assert.equal(message.emailSent, false);
    const link = new URL(message.url);
    assert.match(link.hash, /^#[a-f0-9]{64}$/);
    assert.equal(link.search, "");
    Object.assign(process.env, { NODE_ENV: "production" });
    assert.deepEqual(
      await requestPasswordReset(db, "reset.player@example.com", "FR"),
      { delivery: "unavailable" },
    );
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await db.$disconnect();
    await rm(directory, { recursive: true, force: true });
  }
});
test("concurrent administrator demotions cannot remove the last active administrator", async () => {
  const db = authenticationDatabase();
  const a = await client();
  const b = await client();
  try {
    await db.user.createMany({
      data: [
        {
          id: "guard-admin-a",
          email: "guard-a@example.com",
          role: "ADMIN",
          active: true,
        },
        {
          id: "guard-admin-b",
          email: "guard-b@example.com",
          role: "ADMIN",
          active: true,
        },
      ],
    });
    await db.user.updateMany({
      where: {
        role: "ADMIN",
        active: true,
        id: { notIn: ["guard-admin-a", "guard-admin-b"] },
      },
      data: { role: "USER" },
    });
    await a.query("BEGIN");
    await b.query("BEGIN");
    await a.query(`UPDATE "User" SET "role"='USER' WHERE "id"='guard-admin-a'`);
    const second = b
      .query(`UPDATE "User" SET "role"='USER' WHERE "id"='guard-admin-b'`)
      .then(
        () => null,
        (error: { code: string }) => error.code,
      );
    await a.query("COMMIT");
    assert.equal(await second, "23514");
    await b.query("ROLLBACK");
    assert.equal(
      await db.user.count({ where: { role: "ADMIN", active: true } }),
      1,
    );
  } finally {
    await a.query("ROLLBACK");
    await b.query("ROLLBACK");
    await a.end();
    await b.end();
    await db.$disconnect();
  }
});

// Phase 5 — catalogue and administrator writes use the same services as the APIs.
import { passwordHash } from "../src/server/auth/password.ts";
import {
  listProducts,
  publishedProduct,
  saveProduct,
  CatalogFailure,
} from "../src/server/catalog/service.ts";
import {
  listUsers,
  saveUser,
  overview,
} from "../src/server/administration/service.ts";
const catalogInput = {
  slug: "phase-five-test",
  name: { fr: "Catalogue français", en: "English catalogue" },
  description: { fr: "Description française", en: "English description" },
  price: 3890,
  platform: "PC",
  category: "unlock",
  art: "camo",
  published: false,
  download: "/downloads/demo/unlock-all-demo.txt",
};
test("catalogue writes persist both languages, images and audit records; drafts stay private", async () => {
  const db = authenticationDatabase();
  try {
    const actor = await db.user.create({
      data: {
        email: "catalog-admin@example.com",
        name: "Catalog admin",
        role: "ADMIN",
        passwordHash: await passwordHash(passphrase),
      },
    });
    const draft = await saveProduct(db, actor.id, catalogInput);
    assert.equal(await publishedProduct(db, draft.slug), null);
    assert.ok(!(await listProducts(db)).some((p) => p.id === draft.id));
    assert.ok((await listProducts(db, true)).some((p) => p.id === draft.id));
    const published = await saveProduct(
      db,
      actor.id,
      { ...catalogInput, published: true, updatedAt: draft.updatedAt },
      draft.id,
    );
    assert.equal(
      (await publishedProduct(db, published.slug))?.name.en,
      "English catalogue",
    );
    assert.equal(published.art, "camo");
    assert.equal(
      await db.productTranslation.count({ where: { productId: draft.id } }),
      2,
    );
    assert.equal(
      await db.productImageTranslation.count({
        where: { image: { productId: draft.id } },
      }),
      2,
    );
    assert.equal(await db.auditLog.count({ where: { entityId: draft.id } }), 2);
    const publicJson = JSON.stringify(await listProducts(db));
    assert.ok(!publicJson.includes("ciphertext"));
    assert.ok(!publicJson.includes("passwordHash"));
  } finally {
    await db.$disconnect();
  }
});
test("catalogue rejects unauthorized, forged and stale writes without partially changing data", async () => {
  const db = authenticationDatabase();
  try {
    const actor = await db.user.findUniqueOrThrow({
      where: { email: "catalog-admin@example.com" },
    });
    const product = (await listProducts(db, true)).find(
      (p) => p.slug === catalogInput.slug,
    )!;
    await assert.rejects(
      saveProduct(db, "u1", { ...catalogInput, slug: "forbidden-product" }),
      (e) => e instanceof CatalogFailure && e.status === 403,
    );
    await assert.rejects(
      saveProduct(db, actor.id, { ...catalogInput, isDemo: false }),
      (e) => e instanceof CatalogFailure && e.code === "invalidInput",
    );
    await assert.rejects(
      saveProduct(db, actor.id, {
        ...catalogInput,
        download: "https://attacker.example/file.exe",
      }),
      (e) => e instanceof CatalogFailure && e.code === "invalidInput",
    );
    await assert.rejects(
      saveProduct(db, actor.id, { ...catalogInput, price: 0.1 }),
      (e) => e instanceof CatalogFailure && e.code === "invalidInput",
    );
    const edited = await saveProduct(
      db,
      actor.id,
      {
        ...catalogInput,
        published: true,
        price: 999,
        updatedAt: product.updatedAt,
      },
      product.id,
    );
    await assert.rejects(
      saveProduct(
        db,
        actor.id,
        {
          ...catalogInput,
          published: true,
          price: 1,
          updatedAt: product.updatedAt,
        },
        product.id,
      ),
      (e) => e instanceof CatalogFailure && e.code === "conflict",
    );
    assert.equal((await publishedProduct(db, edited.slug))?.price, 999);
    const count = await db.product.count();
    await assert.rejects(saveProduct(db, actor.id, catalogInput));
    assert.equal(await db.product.count(), count);
    assert.equal(
      await db.auditLog.count({ where: { entityId: product.id } }),
      3,
    );
  } finally {
    await db.$disconnect();
  }
});
test("administrator user updates revoke sessions, reject privilege injection and audit actual changes", async () => {
  const db = authenticationDatabase();
  try {
    const actor = await db.user.findUniqueOrThrow({
      where: { email: "catalog-admin@example.com" },
    });
    const target = await db.user.create({
      data: {
        email: "managed-player@example.com",
        name: "Managed player",
        passwordHash: await passwordHash(passphrase),
      },
    });
    const login = (await authService.authenticate(
      db,
      { email: target.email, password: passphrase },
      "managed-login",
    ))!;
    const sessionId = await authService.createLoginSession(db, login);
    await saveUser(db, actor.id, target.id, {
      role: "ADMIN",
      active: true,
      updatedAt: target.updatedAt.toISOString(),
    });
    assert.equal(
      await authService.sessionUser(db, {
        sub: target.id,
        sessionId,
        sessionVersion: target.sessionVersion,
      }),
      null,
    );
    await assert.rejects(
      saveUser(db, actor.id, target.id, {
        role: "USER",
        active: true,
        email: "changed@example.com",
        updatedAt: target.updatedAt.toISOString(),
      }),
    );
    await assert.rejects(
      saveUser(db, "u1", target.id, {
        role: "USER",
        active: true,
        updatedAt: target.updatedAt.toISOString(),
      }),
      (e) => e instanceof CatalogFailure && e.status === 403,
    );
    const changed = await db.user.findUniqueOrThrow({
      where: { id: target.id },
    });
    await assert.rejects(
      saveUser(db, actor.id, target.id, {
        role: "USER",
        active: true,
        updatedAt: target.updatedAt.toISOString(),
      }),
      (e) => e instanceof CatalogFailure && e.code === "conflict",
    );
    assert.equal(changed.role, "ADMIN");
    assert.equal(
      await db.auditLog.count({
        where: { entityId: target.id, action: "user.security.update" },
      }),
      1,
    );
    const result = await listUsers(db, "managed-player@", 1);
    assert.equal(result.total, 1);
    assert.ok(!("passwordHash" in result.users[0]));
  } finally {
    await db.$disconnect();
  }
});
test("dashboard metrics read PostgreSQL and count available unassigned keys rather than browser data", async () => {
  const db = authenticationDatabase();
  try {
    const stats = await overview(db);
    assert.equal(stats.users, await db.user.count());
    assert.equal(
      stats.orders,
      await db.order.count({ where: { mode: "DEMO" } }),
    );
    assert.equal(
      stats.available,
      await db.product.count({
        where: {
          isDemo: true,
          status: "PUBLISHED",
          keys: { some: { disabledAt: null, assignment: null, isDemo: true } },
        },
      }),
    );
    assert.match(stats.valueCents, /^\d+$/);
  } finally {
    await db.$disconnect();
  }
});

import {
  addKey,
  changeKey,
  revealKey,
  listKeys,
  CommerceFailure,
} from "../src/server/commerce/inventory.ts";
import {
  readCart,
  mutateCart,
  mergeGuestCart,
  validateCart,
  newGuestToken,
  guestHash,
} from "../src/server/commerce/cart.ts";
const stockProduct = "demo-product-unlock-0";
test("inventory writes encrypt keys, mask lists, audit access and reject duplicates across products", async () => {
  const db = authenticationDatabase();
  try {
    const actor = await db.user.findUniqueOrThrow({
      where: { email: "catalog-admin@example.com" },
    });
    const created = await addKey(
      db,
      actor.id,
      { productId: stockProduct, value: " demo-phase-six-encrypted " },
      vault,
    );
    const stored = await db.activationKey.findUniqueOrThrow({
      where: { id: created.id },
    });
    assert.ok(!stored.ciphertext.includes("DEMO-PHASE-SIX-ENCRYPTED"));
    assert.equal(
      (await revealKey(db, actor.id, created.id, vault)).value,
      "DEMO-PHASE-SIX-ENCRYPTED",
    );
    const listing = JSON.stringify(await listKeys(db, stockProduct));
    assert.ok(!listing.includes("DEMO-PHASE-SIX-ENCRYPTED"));
    assert.ok(!listing.includes("ciphertext"));
    assert.ok(!listing.includes(stored.fingerprint));
    await assert.rejects(
      addKey(
        db,
        actor.id,
        {
          productId: "demo-product-camos-0",
          value: "DEMO-PHASE-SIX-ENCRYPTED",
        },
        vault,
      ),
      (e) => e instanceof CommerceFailure && e.code === "duplicateKey",
    );
    await changeKey(db, actor.id, created.id, { disabled: true });
    assert.equal(
      (await listProducts(db)).find((p) => p.id === stockProduct)
        ?.availableStock,
      6,
    );
    await assert.rejects(
      addKey(
        db,
        "u1",
        { productId: stockProduct, value: "DEMO-FORBIDDEN-KEY" },
        vault,
      ),
    );
    assert.equal(
      await db.auditLog.count({ where: { entityId: created.id } }),
      3,
    );
  } finally {
    await db.$disconnect();
  }
});
test("guest carts persist only hashed tokens, reject invalid prices and quantities, and do not reserve keys", async () => {
  const db = authenticationDatabase();
  try {
    const token = newGuestToken();
    const owner = { guestToken: token };
    const count = await db.keyAssignment.count();
    const initial = await readCart(db, owner);
    assert.equal(initial.items.length, 0);
    const result = await mutateCart(db, owner, {
      operation: "add",
      productId: stockProduct,
      quantity: 2,
    });
    assert.equal(result.items[0].quantity, 2);
    assert.equal(result.totalCents, 5980);
    const stored = await db.cart.findUniqueOrThrow({
      where: { guestTokenHash: guestHash(token) },
    });
    assert.notEqual(stored.guestTokenHash, token);
    assert.equal(stored.userId, null);
    assert.ok(stored.expiresAt! > new Date());
    for (const extra of [
      { quantity: -1 },
      { quantity: 1.5 },
      { price: 1 },
      { userId: "u1" },
      { quantity: 1000 },
    ])
      await assert.rejects(
        mutateCart(db, owner, {
          operation: "add",
          productId: stockProduct,
          quantity: 1,
          ...extra,
        }),
      );
    assert.equal((await readCart(db, owner)).items[0].quantity, 2);
    assert.equal(await db.keyAssignment.count(), count);
  } finally {
    await db.$disconnect();
  }
});
test("cart updates are isolated by owner, revision checked and additive under concurrency", async () => {
  const db = authenticationDatabase();
  const other = authenticationDatabase();
  try {
    const owner = { guestToken: newGuestToken() };
    const stranger = { guestToken: newGuestToken() };
    await readCart(db, owner);
    await Promise.all([
      mutateCart(db, owner, {
        operation: "add",
        productId: stockProduct,
        quantity: 1,
      }),
      mutateCart(other, owner, {
        operation: "add",
        productId: stockProduct,
        quantity: 1,
      }),
    ]);
    const result = await readCart(db, owner);
    assert.equal(result.items[0].quantity, 2);
    assert.equal((await readCart(db, stranger)).items.length, 0);
    await mutateCart(db, owner, {
      operation: "set",
      productId: stockProduct,
      quantity: 1,
      revision: result.revision,
    });
    await assert.rejects(
      mutateCart(other, owner, {
        operation: "set",
        productId: stockProduct,
        quantity: 3,
        revision: result.revision,
      }),
      (e) => e instanceof CommerceFailure && e.code === "cartConflict",
    );
    assert.equal((await readCart(db, owner)).items[0].quantity, 1);
  } finally {
    await db.$disconnect();
    await other.$disconnect();
  }
});
test("concurrent guest merge is single-use, combines quantities and clamps to shared inventory", async () => {
  const db = authenticationDatabase();
  const other = authenticationDatabase();
  try {
    const user = await db.user.findUniqueOrThrow({
      where: { email: "managed-player@example.com" },
    });
    const guest = newGuestToken();
    await mutateCart(
      db,
      { guestToken: guest },
      { operation: "add", productId: stockProduct, quantity: 6 },
    );
    await mutateCart(
      db,
      { userId: user.id },
      { operation: "add", productId: stockProduct, quantity: 3 },
    );
    const results = await Promise.all([
      mergeGuestCart(db, user.id, guest),
      mergeGuestCart(other, user.id, guest),
    ]);
    assert.equal(
      (await readCart(db, { userId: user.id })).items[0].quantity,
      6,
    );
    assert.ok(results.some((r) => r.adjusted));
    assert.equal(
      await db.cart.findUnique({ where: { guestTokenHash: guestHash(guest) } }),
      null,
    );
    await mergeGuestCart(db, user.id, guest);
    assert.equal(
      (await readCart(db, { userId: user.id })).items[0].quantity,
      6,
    );
  } finally {
    await db.$disconnect();
    await other.$disconnect();
  }
});
test("cart validation detects stock changes and unpublished products without assigning or consuming keys", async () => {
  const db = authenticationDatabase();
  try {
    const user = await db.user.create({
      data: {
        email: "cart-validator@example.com",
        passwordHash: await passwordHash(passphrase),
      },
    });
    const owner = { userId: user.id };
    await mutateCart(db, owner, {
      operation: "add",
      productId: stockProduct,
      quantity: 2,
    });
    const before = await db.keyAssignment.count();
    assert.equal((await validateCart(db, user.id)).valid, true);
    const product = await db.product.findUniqueOrThrow({
      where: { id: stockProduct },
    });
    await db.product.update({
      where: { id: stockProduct },
      data: { status: "DRAFT" },
    });
    assert.equal((await readCart(db, owner)).valid, false);
    await assert.rejects(
      validateCart(db, user.id),
      (e) => e instanceof CommerceFailure && e.code === "stockError",
    );
    await db.product.update({
      where: { id: stockProduct },
      data: { status: product.status },
    });
    const expired = newGuestToken();
    await readCart(db, { guestToken: expired });
    await db.cart.update({
      where: { guestTokenHash: guestHash(expired) },
      data: { expiresAt: new Date(0) },
    });
    await assert.rejects(
      readCart(db, { guestToken: expired }),
      (e) => e instanceof CommerceFailure && e.code === "cartExpired",
    );
    assert.equal(await db.keyAssignment.count(), before);
  } finally {
    await db.$disconnect();
  }
});
test("SQL rejects ownerless carts and assigned keys remain protected through the inventory service", async () => {
  await rollbackTest(async (c) => {
    await sqlError(c, "23514", () =>
      c.query(
        `INSERT INTO "Cart" ("id","updatedAt") VALUES ('ownerless-cart',now())`,
      ),
    );
    await sqlError(c, "23514", () =>
      c.query(
        `INSERT INTO "Cart" ("id","userId","guestTokenHash","expiresAt","updatedAt") VALUES ('mixed-cart','u1',$1,now(),now())`,
        ["a".repeat(64)],
      ),
    );
  });
  const db = authenticationDatabase();
  try {
    const actor = await db.user.findUniqueOrThrow({
      where: { email: "catalog-admin@example.com" },
    });
    // A previously committed assignment from the integrity suite, if any, is protected.
    const assignment = await db.keyAssignment.findFirst();
    if (assignment)
      await assert.rejects(
        changeKey(db, actor.id, assignment.keyId, { disabled: true }),
        (e) => e instanceof CommerceFailure && e.code === "keyAssigned",
      );
  } finally {
    await db.$disconnect();
  }
});

import { randomUUID } from "node:crypto";
import {
  createOrder,
  orderDetails,
  listOrders,
  orderDownload,
} from "../src/server/commerce/orders.ts";
const demoEnv = { APP_MODE: "demo", DEMO_CHECKOUT_ENABLED: "true" };
async function checkoutFixture(
  db: ReturnType<typeof authenticationDatabase>,
  stock = 3,
  quantity = 2,
) {
  const id = randomUUID();
  const user = await db.user.create({
    data: {
      email: `order-${id}@example.com`,
      passwordHash: await passwordHash(passphrase),
    },
  });
  const product = await db.product.create({
    data: {
      slug: `order-${id}`,
      priceCents: 1290,
      status: "PUBLISHED",
      isDemo: true,
      categoryId: "c1",
      gameId: "g1",
      platformId: "plat1",
      downloadUrl: "/downloads/demo/unlock-all-demo.txt",
      translations: {
        create: [
          {
            locale: "FR",
            slug: `order-fr-${id}`,
            shortDescription: "Démo",
            name: "Nom figé",
            description: "Démo",
          },
          {
            locale: "EN",
            slug: `order-en-${id}`,
            shortDescription: "Demo",
            name: "Snapshot name",
            description: "Demo",
          },
        ],
      },
    },
  });
  for (let i = 0; i < stock; i++)
    await db.activationKey.create({
      data: {
        productId: product.id,
        isDemo: true,
        ...sealKey(`DEMO-ORDER-${id}-${i}`, vault),
      },
    });
  await db.siteSetting.update({
    where: { id: "site" },
    data: { demoEnabled: true },
  });
  await mutateCart(
    db,
    { userId: user.id },
    { operation: "add", productId: product.id, quantity },
  );
  const cart = await readCart(db, { userId: user.id });
  const input = {
    idempotencyKey: randomUUID(),
    cartRevision: cart.revision,
    cartFingerprint: cart.fingerprint,
    discord: "player.demo",
    locale: "FR",
    consent: true,
  };
  return { user, product, input };
}
const orderOptions = { env: demoEnv, vault };
test("checkout allocates one distinct encrypted stock key per unit, clears cart and preserves snapshots", async () => {
  const db = authenticationDatabase();
  try {
    const f = await checkoutFixture(db);
    const result = await createOrder(db, f.user.id, f.input, orderOptions);
    assert.equal(result.order.status, "completed");
    assert.equal(result.order.total, 2580);
    assert.equal((await readCart(db, { userId: f.user.id })).items.length, 0);
    const detail = await orderDetails(
      db,
      f.user.id,
      result.order.id,
      false,
      vault,
    );
    assert.equal(detail.items[0].keys.length, 2);
    assert.equal(new Set(detail.items[0].keys).size, 2);
    assert.ok(detail.items[0].keys.every((k) => k.startsWith("DEMO-ORDER-")));
    await db.product.update({
      where: { id: f.product.id },
      data: {
        priceCents: 9999,
        translations: {
          update: {
            where: {
              productId_locale: { productId: f.product.id, locale: "FR" },
            },
            data: { name: "Nom changé" },
          },
        },
      },
    });
    const again = await orderDetails(
      db,
      f.user.id,
      result.order.id,
      false,
      vault,
    );
    assert.equal(again.items[0].name.fr, "Nom figé");
    assert.equal(again.items[0].unitPrice, 1290);
    assert.deepEqual(again.items[0].keys, detail.items[0].keys);
    assert.equal(
      await orderDownload(db, f.user.id, result.order.id, detail.items[0].id),
      "/downloads/demo/unlock-all-demo.txt",
    );
    const record = await db.order.findUniqueOrThrow({
      where: { id: result.order.id },
    });
    assert.equal(record.mode, "DEMO");
    assert.equal(record.paymentStatus, "NOT_REQUIRED");
    assert.equal(await db.emailJob.count({ where: { orderId: record.id } }), 0);
  } finally {
    await db.$disconnect();
  }
});
test("concurrent retries with the same idempotency key allocate exactly once; payload changes are rejected", async () => {
  const db = authenticationDatabase(),
    other = authenticationDatabase();
  try {
    const f = await checkoutFixture(db);
    const results = await Promise.all([
      createOrder(db, f.user.id, f.input, orderOptions),
      createOrder(other, f.user.id, f.input, orderOptions),
    ]);
    assert.equal(results[0].order.id, results[1].order.id);
    assert.deepEqual(results.map((r) => r.replayed).sort(), [false, true]);
    assert.equal(
      await db.keyAssignment.count({ where: { productId: f.product.id } }),
      2,
    );
    assert.equal(
      await db.orderEvent.count({
        where: { orderId: results[0].order.id, type: "DELIVERED" },
      }),
      1,
    );
    await assert.rejects(
      createOrder(
        db,
        f.user.id,
        { ...f.input, discord: "different.demo" },
        orderOptions,
      ),
      (e) => e instanceof CommerceFailure && e.code === "orderConflict",
    );
    // A response lost before demo shutdown can still be retrieved safely.
    assert.equal(
      (
        await createOrder(db, f.user.id, f.input, {
          env: { APP_MODE: "commercial" },
          vault,
        })
      ).replayed,
      true,
    );
  } finally {
    await db.$disconnect();
    await other.$disconnect();
  }
});
test("two customers competing for the last key produce one complete order and one recorded failure", async () => {
  const db = authenticationDatabase(),
    other = authenticationDatabase();
  try {
    const f = await checkoutFixture(db, 1, 1);
    const second = await db.user.create({
      data: {
        email: `competitor-${randomUUID()}@example.com`,
        passwordHash: await passwordHash(passphrase),
      },
    });
    await mutateCart(
      db,
      { userId: second.id },
      { operation: "add", productId: f.product.id, quantity: 1 },
    );
    const cart = await readCart(db, { userId: second.id });
    const secondInput = {
      ...f.input,
      idempotencyKey: randomUUID(),
      cartRevision: cart.revision,
      cartFingerprint: cart.fingerprint,
    };
    const results = await Promise.all([
      createOrder(db, f.user.id, f.input, orderOptions),
      createOrder(other, second.id, secondInput, orderOptions),
    ]);
    assert.deepEqual(results.map((r) => r.order.status).sort(), [
      "completed",
      "failed",
    ]);
    assert.equal(
      await db.keyAssignment.count({ where: { productId: f.product.id } }),
      1,
    );
    const loser = results[0].order.status === "failed" ? f.user : second;
    assert.equal((await readCart(db, { userId: loser.id })).items.length, 1);
    const failed = results.find((r) => r.order.status === "failed")!;
    assert.equal(
      (await orderDetails(db, loser.id, failed.order.id, false, vault)).items[0]
        .keys.length,
      0,
    );
  } finally {
    await db.$disconnect();
    await other.$disconnect();
  }
});
test("a failed multi-product order assigns nothing and keeps every cart line", async () => {
  const db = authenticationDatabase();
  try {
    const f = await checkoutFixture(db);
    const other = await checkoutFixture(db, 1, 1);
    await mutateCart(
      db,
      { userId: f.user.id },
      { operation: "add", productId: other.product.id, quantity: 1 },
    );
    const cart = await readCart(db, { userId: f.user.id });
    await db.activationKey.updateMany({
      where: { productId: other.product.id },
      data: { disabledAt: new Date() },
    });
    const result = await createOrder(
      db,
      f.user.id,
      {
        ...f.input,
        cartRevision: cart.revision,
        cartFingerprint: cart.fingerprint,
      },
      orderOptions,
    );
    assert.equal(result.order.status, "failed");
    assert.equal(
      await db.keyAssignment.count({
        where: { productId: { in: [f.product.id, other.product.id] } },
      }),
      0,
    );
    assert.equal((await readCart(db, { userId: f.user.id })).items.length, 2);
  } finally {
    await db.$disconnect();
  }
});
test("changed prices or revision, injected checkout fields and demo gates cannot create orders", async () => {
  const db = authenticationDatabase();
  try {
    const f = await checkoutFixture(db);
    for (const env of [
      { APP_MODE: "commercial", DEMO_CHECKOUT_ENABLED: "true" },
      { APP_MODE: "demo", DEMO_CHECKOUT_ENABLED: "false" },
    ])
      await assert.rejects(
        createOrder(db, f.user.id, f.input, { env, vault }),
        (e) => e instanceof CommerceFailure && e.code === "demoDisabled",
      );
    await db.siteSetting.update({
      where: { id: "site" },
      data: { demoEnabled: false },
    });
    await assert.rejects(
      createOrder(db, f.user.id, f.input, orderOptions),
      (e) => e instanceof CommerceFailure && e.code === "demoDisabled",
    );
    await db.siteSetting.update({
      where: { id: "site" },
      data: { demoEnabled: true },
    });
    await assert.rejects(
      createOrder(
        db,
        f.user.id,
        { ...f.input, mode: "COMMERCIAL", total: 1 },
        orderOptions,
      ),
      (e) => e instanceof CommerceFailure && e.code === "invalidInput",
    );
    await assert.rejects(
      createOrder(db, f.user.id, { ...f.input, cartRevision: 0 }, orderOptions),
      (e) => e instanceof CommerceFailure && e.code === "cartConflict",
    );
    await db.product.update({
      where: { id: f.product.id },
      data: { priceCents: 1390 },
    });
    await assert.rejects(
      createOrder(db, f.user.id, f.input, orderOptions),
      (e) => e instanceof CommerceFailure && e.code === "cartConflict",
    );
    assert.equal(await db.order.count({ where: { userId: f.user.id } }), 0);
  } finally {
    await db.$disconnect();
  }
});
test("corrupted stock records need attention without partial delivery or cart loss", async () => {
  const db = authenticationDatabase();
  try {
    const f = await checkoutFixture(db, 1, 1);
    await db.activationKey.updateMany({
      where: { productId: f.product.id },
      data: {
        ciphertext: sealKey("DEMO-CORRUPT", {
          ...vault,
          encryptionKey: randomBytes(32),
        }).ciphertext,
      },
    });
    const result = await createOrder(db, f.user.id, f.input, orderOptions);
    const row = await db.order.findUniqueOrThrow({
      where: { id: result.order.id },
    });
    assert.equal(row.status, "NEEDS_ATTENTION");
    assert.equal(result.order.status, "failed");
    assert.equal(
      await db.keyAssignment.count({ where: { productId: f.product.id } }),
      0,
    );
    assert.equal((await readCart(db, { userId: f.user.id })).items.length, 1);
  } finally {
    await db.$disconnect();
  }
});
test("order history, keys and downloads are restricted to the owner or a real administrator", async () => {
  const db = authenticationDatabase();
  try {
    const f = await checkoutFixture(db),
      outsider = await checkoutFixture(db, 1, 1);
    const result = await createOrder(db, f.user.id, f.input, orderOptions);
    const detail = await orderDetails(
      db,
      f.user.id,
      result.order.id,
      false,
      vault,
    );
    await assert.rejects(
      orderDetails(db, outsider.user.id, result.order.id, false, vault),
      (e) => e instanceof CommerceFailure && e.status === 404,
    );
    await assert.rejects(
      orderDownload(db, outsider.user.id, result.order.id, detail.items[0].id),
      (e) => e instanceof CommerceFailure && e.status === 404,
    );
    await assert.rejects(
      orderDetails(db, outsider.user.id, result.order.id, true, vault),
      (e) => e instanceof CommerceFailure && e.status === 403,
    );
    assert.equal((await listOrders(db, outsider.user.id)).orders.length, 0);
    const actor = await db.user.findUniqueOrThrow({
      where: { email: "catalog-admin@example.com" },
    });
    assert.equal(
      (await orderDetails(db, actor.id, result.order.id, true, vault)).items[0]
        .keys.length,
      2,
    );
    assert.ok(
      !JSON.stringify(
        await listOrders(db, actor.id, { admin: true, q: f.user.email }),
      ).includes("DEMO-ORDER-"),
    );
  } finally {
    await db.$disconnect();
  }
});

test("an error during the second key assignment rolls back the order, first assignment and cart changes", async () => {
  const db = authenticationDatabase();
  let trigger = false;
  try {
    const f = await checkoutFixture(db);
    // This trigger exists only inside this test's disposable SQL schema.
    await admin.query(
      `CREATE FUNCTION "test_abort_allocation"() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW."productId"='${f.product.id}' AND NEW."unitIndex"=2 THEN RAISE EXCEPTION 'test allocation failure'; END IF; RETURN NEW; END $$`,
    );
    await admin.query(
      `CREATE TRIGGER "test_abort_allocation" BEFORE INSERT ON "KeyAssignment" FOR EACH ROW EXECUTE FUNCTION "test_abort_allocation"()`,
    );
    trigger = true;
    await assert.rejects(createOrder(db, f.user.id, f.input, orderOptions));
    assert.equal(await db.order.count({ where: { userId: f.user.id } }), 0);
    assert.equal(
      await db.keyAssignment.count({ where: { productId: f.product.id } }),
      0,
    );
    assert.equal(
      (await readCart(db, { userId: f.user.id })).items[0].quantity,
      2,
    );
    await admin.query(
      `DROP TRIGGER "test_abort_allocation" ON "KeyAssignment"`,
    );
    trigger = false;
    assert.equal(
      (await createOrder(db, f.user.id, f.input, orderOptions)).order.status,
      "completed",
    );
  } finally {
    if (trigger)
      await admin.query(
        `DROP TRIGGER "test_abort_allocation" ON "KeyAssignment"`,
      );
    await admin.query(`DROP FUNCTION IF EXISTS "test_abort_allocation"()`);
    await db.$disconnect();
  }
});

import { runEmailJobs } from "../src/server/email/worker.ts";
import { DeliveryFailure } from "../src/server/email/resend.ts";
import { enqueueEmail } from "../src/server/email/outbox.ts";
import { retryOrderEmails } from "../src/server/email/retry.ts";
import { openPayload } from "../src/server/email/payload.ts";
import type { EmailPayload } from "../src/server/email/payload.ts";
import { requestPasswordReset } from "../src/server/auth/reset-delivery.ts";
const emailEnvironment = (recipient: string) => ({
  ...demoEnv,
  EMAIL_DELIVERY: "resend-test",
  EMAIL_TEST_RECIPIENT: recipient,
  RESEND_API_KEY: "re_FAKE_KEY_FOR_ISOLATED_TESTS_123456789",
  NEXTAUTH_URL: "http://127.0.0.1:3000",
});

test("welcome email is queued atomically and concurrent workers submit it only once", async () => {
  const db = authenticationDatabase(),
    other = authenticationDatabase();
  try {
    const email = `welcome-${randomUUID()}@example.com`,
      env = emailEnvironment(email);
    const user = await authService.registerUser(
      db,
      { email, password: passphrase, nickname: "<b>Player</b>", locale: "EN" },
      randomUUID(),
      env,
    );
    assert.equal(
      await db.emailJob.count({ where: { userId: user.id, kind: "WELCOME" } }),
      1,
    );
    let calls = 0;
    let body = "";
    const send = async (payload: EmailPayload) => {
      calls++;
      body = payload.html;
      await new Promise((r) => setTimeout(r, 20));
      return "fake-provider-id";
    };
    const results = await Promise.all([
      runEmailJobs(db, { env, vault, send, pauseMs: 0 }),
      runEmailJobs(other, { env, vault, send, pauseMs: 0 }),
    ]);
    assert.equal(calls, 1);
    assert.equal(
      results.reduce((n, r) => n + r.sent, 0),
      1,
    );
    assert.ok(body.includes("&lt;b&gt;Player&lt;/b&gt;"));
    assert.ok(!body.includes("<b>Player</b>"));
    const job = await db.emailJob.findFirstOrThrow({
      where: { userId: user.id },
    });
    assert.equal(job.status, "SENT");
    assert.equal(job.payloadCiphertext, null);
    assert.equal(
      (await runEmailJobs(db, { env, vault, send, pauseMs: 0 })).processed,
      0,
    );
  } finally {
    await db.$disconnect();
    await other.$disconnect();
  }
});

test("order confirmation and key delivery are durable and retry an identical encrypted payload without reassigning keys", async () => {
  const db = authenticationDatabase();
  try {
    const f = await checkoutFixture(db),
      env = emailEnvironment(f.user.email);
    const result = await createOrder(db, f.user.id, f.input, {
      ...orderOptions,
      emailEnv: env,
    });
    assert.equal(
      await db.emailJob.count({ where: { orderId: result.order.id } }),
      2,
    );
    await createOrder(db, f.user.id, f.input, {
      ...orderOptions,
      emailEnv: env,
    });
    assert.equal(
      await db.emailJob.count({ where: { orderId: result.order.id } }),
      2,
    );
    const requests = new Map<string, string>();
    const first = await runEmailJobs(db, {
      env,
      vault,
      pauseMs: 0,
      send: async (payload, id) => {
        requests.set(id, JSON.stringify(payload));
        throw new DeliveryFailure("PROVIDER_429", true);
      },
    });
    assert.equal(first.retry, 2);
    const jobs = await db.emailJob.findMany({
      where: { orderId: result.order.id },
    });
    assert.ok(
      jobs.every(
        (j) =>
          j.payloadCiphertext && !j.payloadCiphertext.includes("DEMO-ORDER-"),
      ),
    );
    await db.user.update({
      where: { id: f.user.id },
      data: { name: "Changed after first send" },
    });
    await db.emailJob.updateMany({
      where: { orderId: result.order.id },
      data: { nextAttemptAt: new Date(0) },
    });
    const second = await runEmailJobs(db, {
      env,
      vault,
      pauseMs: 0,
      send: async (payload, id) => {
        assert.equal(JSON.stringify(payload), requests.get(id));
        return "fake-provider-id";
      },
    });
    assert.equal(second.sent, 2);
    const confirmation = JSON.parse(
      [...requests.entries()].find(([key]) =>
        key.startsWith("order_confirmation/"),
      )![1],
    ) as EmailPayload;
    const delivery = JSON.parse(
      [...requests.entries()].find(([key]) =>
        key.startsWith("key_delivery/"),
      )![1],
    ) as EmailPayload;
    assert.ok(!confirmation.text.includes("DEMO-ORDER-"));
    assert.equal((delivery.text.match(/DEMO-ORDER-/g) ?? []).length, 2);
    assert.equal(
      await db.keyAssignment.count({ where: { productId: f.product.id } }),
      2,
    );
    assert.equal(
      (await db.order.findUniqueOrThrow({ where: { id: result.order.id } }))
        .status,
      "COMPLETED",
    );
    assert.equal(
      await db.orderEvent.count({
        where: { orderId: result.order.id, type: "EMAIL_FAILED" },
      }),
      2,
    );
  } finally {
    await db.$disconnect();
  }
});

test("password reset email encrypts its raw token, returns an identical generic response and remains single use", async () => {
  const db = authenticationDatabase();
  try {
    const f = await checkoutFixture(db),
      env = emailEnvironment(f.user.email);
    const known = await requestPasswordReset(db, f.user.email, "EN", {
      env,
      vault,
    });
    assert.deepEqual(
      known,
      await requestPasswordReset(db, "unknown-email@example.com", "EN", {
        env,
        vault,
      }),
    );
    assert.deepEqual(known, { delivery: "email" });
    const job = await db.emailJob.findFirstOrThrow({
      where: { userId: f.user.id, kind: "PASSWORD_RESET" },
    });
    const payload = openPayload(
      job.id,
      {
        payloadCiphertext: job.payloadCiphertext!,
        payloadKeyId: job.payloadKeyId!,
      },
      vault,
    );
    const token = payload.text.match(/#([a-f0-9]{64})/)![1];
    assert.ok(!JSON.stringify(job).includes(token));
    assert.ok(payload.subject.includes("Reset"));
    const sent = await runEmailJobs(db, {
      env,
      vault,
      pauseMs: 0,
      send: async (p) => {
        assert.equal(p.text, payload.text);
        return "fake-reset-id";
      },
    });
    assert.equal(sent.sent, 1);
    await authService.resetPassword(db, {
      token,
      password: "A new email delivered secure passphrase!",
    });
    await assert.rejects(
      authService.resetPassword(db, { token, password: passphrase }),
      (e) => e instanceof AuthFailure && e.code === "invalidReset",
    );
  } finally {
    await db.$disconnect();
  }
});

test("superseded and expired reset messages are never submitted to Resend", async () => {
  const db = authenticationDatabase();
  try {
    const f = await checkoutFixture(db),
      env = emailEnvironment(f.user.email);
    await requestPasswordReset(db, f.user.email, "FR", { env, vault });
    await requestPasswordReset(db, f.user.email, "FR", { env, vault });
    const jobs = await db.emailJob.findMany({
      where: { userId: f.user.id, kind: "PASSWORD_RESET" },
    });
    assert.equal(
      jobs.filter(
        (j) => j.status === "FAILED" && j.lastErrorCode === "RESET_SUPERSEDED",
      ).length,
      1,
    );
    const active = jobs.find((j) => j.status === "PENDING")!;
    await db.passwordResetToken.update({
      where: { id: active.resetTokenId! },
      data: { usedAt: new Date() },
    });
    let calls = 0;
    await runEmailJobs(db, {
      env,
      vault,
      pauseMs: 0,
      send: async () => {
        calls++;
        return "not-sent";
      },
    });
    assert.equal(calls, 0);
    assert.equal(
      (await db.emailJob.findUniqueOrThrow({ where: { id: active.id } }))
        .lastErrorCode,
      "RESET_EXPIRED",
    );
  } finally {
    await db.$disconnect();
  }
});

test("permanent provider failures preserve completed orders and only administrators can schedule bounded retries", async () => {
  const db = authenticationDatabase();
  try {
    const f = await checkoutFixture(db),
      env = emailEnvironment(f.user.email);
    const { order } = await createOrder(db, f.user.id, f.input, {
      ...orderOptions,
      emailEnv: env,
    });
    await runEmailJobs(db, {
      env,
      vault,
      pauseMs: 0,
      send: async () => {
        throw new DeliveryFailure("PROVIDER_403", false);
      },
    });
    assert.equal(
      await db.emailJob.count({
        where: { orderId: order.id, status: "FAILED" },
      }),
      2,
    );
    assert.equal(
      (await db.order.findUniqueOrThrow({ where: { id: order.id } })).status,
      "COMPLETED",
    );
    await assert.rejects(
      retryOrderEmails(db, f.user.id, order.id, env),
      (e) => e instanceof CommerceFailure && e.status === 403,
    );
    const actor = await db.user.findUniqueOrThrow({
      where: { email: "catalog-admin@example.com" },
    });
    assert.equal(
      (await retryOrderEmails(db, actor.id, order.id, env)).queued,
      2,
    );
    assert.equal(
      (
        await runEmailJobs(db, {
          env,
          vault,
          pauseMs: 0,
          send: async () => "fake-id",
        })
      ).sent,
      2,
    );
    assert.equal(
      await db.keyAssignment.count({ where: { productId: f.product.id } }),
      2,
    );
  } finally {
    await db.$disconnect();
  }
});

test("unknown outcomes past the provider idempotency window require reconciliation instead of another send", async () => {
  const db = authenticationDatabase();
  try {
    const f = await checkoutFixture(db),
      env = emailEnvironment(f.user.email);
    const { order } = await createOrder(db, f.user.id, f.input, {
      ...orderOptions,
      emailEnv: env,
    });
    await db.emailJob.updateMany({
      where: { orderId: order.id },
      data: {
        status: "PROCESSING",
        attempts: 1,
        firstAttemptAt: new Date(Date.now() - 25 * 60 * 60 * 1000),
        lockedUntil: new Date(0),
        lockToken: "expired",
      },
    });
    let calls = 0;
    const result = await runEmailJobs(db, {
      env,
      vault,
      pauseMs: 0,
      send: async () => {
        calls++;
        return "not-sent";
      },
    });
    assert.equal(result.failed, 2);
    assert.equal(calls, 0);
    const actor = await db.user.findUniqueOrThrow({
      where: { email: "catalog-admin@example.com" },
    });
    await assert.rejects(
      retryOrderEmails(db, actor.id, order.id, env),
      (e) => e instanceof CommerceFailure && e.code === "emailReviewRequired",
    );
  } finally {
    await db.$disconnect();
  }
});

test("an expired worker lease recovers frozen emails safely and never reissues keys", async () => {
  const db = authenticationDatabase();
  try {
    const f = await checkoutFixture(db),
      env = emailEnvironment(f.user.email);
    const { order } = await createOrder(db, f.user.id, f.input, {
      ...orderOptions,
      emailEnv: env,
    });
    const bodies = new Map<string, string>();
    await runEmailJobs(db, {
      env,
      vault,
      pauseMs: 0,
      send: async (payload, id) => {
        bodies.set(id, JSON.stringify(payload));
        throw new DeliveryFailure("PROVIDER_NETWORK", true);
      },
    });
    await db.emailJob.updateMany({
      where: { orderId: order.id },
      data: {
        status: "PROCESSING",
        lockedUntil: new Date(0),
        lockToken: "crashed-worker",
      },
    });
    await db.emailWorkerLease.update({
      where: { id: "dispatch" },
      data: { lockedUntil: new Date(0), token: "crashed-worker" },
    });
    let calls = 0;
    await runEmailJobs(db, {
      env,
      vault,
      pauseMs: 0,
      send: async (payload, id) => {
        calls++;
        assert.equal(JSON.stringify(payload), bodies.get(id));
        return "recovered-id";
      },
    });
    assert.equal(calls, 2);
    assert.equal(
      await db.keyAssignment.count({ where: { productId: f.product.id } }),
      2,
    );
  } finally {
    await db.$disconnect();
  }
});

test("test-mode policy never redirects another customer’s secrets to the operator inbox", async () => {
  const db = authenticationDatabase();
  try {
    const f = await checkoutFixture(db),
      env = emailEnvironment("operator@example.com");
    await createOrder(db, f.user.id, f.input, {
      ...orderOptions,
      emailEnv: env,
    });
    assert.equal(await db.emailJob.count({ where: { userId: f.user.id } }), 0);
    const job = await db.emailJob.create({
      data: {
        userId: f.user.id,
        recipient: f.user.email,
        kind: "WELCOME",
        idempotencyKey: `forced/${randomUUID()}`,
      },
    });
    let calls = 0;
    await runEmailJobs(db, {
      env,
      vault,
      pauseMs: 0,
      send: async () => {
        calls++;
        return "not-sent";
      },
    });
    assert.equal(calls, 0);
    assert.equal(
      (await db.emailJob.findUniqueOrThrow({ where: { id: job.id } }))
        .lastErrorCode,
      "RECIPIENT_RESTRICTED",
    );
  } finally {
    await db.$disconnect();
  }
});

test("a failure writing the order email outbox rolls back allocation and cart clearing together", async () => {
  const db = authenticationDatabase();
  let trigger = false;
  try {
    const f = await checkoutFixture(db),
      env = emailEnvironment(f.user.email);
    await admin.query(
      `CREATE FUNCTION "test_abort_email"() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW."userId"='${f.user.id}' THEN RAISE EXCEPTION 'test outbox failure'; END IF; RETURN NEW; END $$`,
    );
    await admin.query(
      `CREATE TRIGGER "test_abort_email" BEFORE INSERT ON "EmailJob" FOR EACH ROW EXECUTE FUNCTION "test_abort_email"()`,
    );
    trigger = true;
    await assert.rejects(
      createOrder(db, f.user.id, f.input, { ...orderOptions, emailEnv: env }),
    );
    assert.equal(await db.order.count({ where: { userId: f.user.id } }), 0);
    assert.equal(
      await db.keyAssignment.count({ where: { productId: f.product.id } }),
      0,
    );
    assert.equal(await db.emailJob.count({ where: { userId: f.user.id } }), 0);
    assert.equal(
      (await readCart(db, { userId: f.user.id })).items[0].quantity,
      2,
    );
  } finally {
    if (trigger)
      await admin.query(`DROP TRIGGER "test_abort_email" ON "EmailJob"`);
    await admin.query(`DROP FUNCTION IF EXISTS "test_abort_email"()`);
    await db.$disconnect();
  }
});

test("Prisma schedules email timestamps on the same absolute UTC clock as PostgreSQL", async () => {
  const db = authenticationDatabase();
  try {
    const f = await checkoutFixture(db),
      due = new Date(Date.now() + 60000);
    const job = await db.emailJob.create({
      data: {
        userId: f.user.id,
        recipient: f.user.email,
        kind: "WELCOME",
        idempotencyKey: `clock/${randomUUID()}`,
        nextAttemptAt: due,
      },
    });
    const [row] = await db.$queryRaw<
      { epoch: number; eligible: boolean; zone: string }[]
    >`SELECT (extract(epoch from "nextAttemptAt")*1000)::float8 as epoch,"nextAttemptAt"<=now() as eligible,current_setting('TimeZone') as zone FROM "EmailJob" WHERE "id"=${job.id}`;
    assert.equal(row.zone, "UTC");
    assert.equal(row.eligible, false);
    assert.ok(Math.abs(row.epoch - due.getTime()) < 2);
  } finally {
    await db.$disconnect();
  }
});

import { activateMerchant } from "../src/server/paypal/merchants.ts";
import {
  preparePayPalCheckout,
  reconcilePayPal,
  readPayPalCheckout,
  expireCheckout,
} from "../src/server/paypal/service.ts";
import { PayPalFailure, type PayPalAPI } from "../src/server/paypal/api.ts";
import { processPayPalWebhook } from "../src/server/paypal/webhook.ts";
import { openMerchant } from "../src/server/paypal/crypto.ts";
const paypalTestEnv = {
  APP_MODE: "demo",
  PAYPAL_ENV: "sandbox",
  PAYPAL_CHECKOUT_ENABLED: "true",
  NEXTAUTH_URL: "http://127.0.0.1:3000",
  EMAIL_DELIVERY: "none",
};
async function paypalFixture(
  db: ReturnType<typeof authenticationDatabase>,
  stock = 3,
  quantity = 2,
) {
  const f = await checkoutFixture(db, stock, quantity),
    suffix = randomUUID().replaceAll("-", "");
  const credentials = {
    clientId: `test-client-${suffix}`,
    secret: `test-secret-${suffix}`,
  };
  const merchant = await activateMerchant(
    db,
    credentials,
    `MERCHANT${suffix.toUpperCase()}`,
    "Test account",
    vault,
    "WH-TEST",
  );
  let remote: any = null,
    captures = 0,
    creates = 0,
    loseCapture = false,
    signature = true,
    tamper: ((r: any) => void) | null = null,
    captureStatus = "COMPLETED";
  const requestedMerchants: string[] = [];
  const api = (merchantId: string): PayPalAPI => ({
    async request(path, method = "GET", body: any) {
      requestedMerchants.push(merchantId);
      if (path.includes("verify-webhook"))
        return { verification_status: signature ? "SUCCESS" : "FAILURE" };
      if (path.startsWith("/v2/payments/captures/"))
        return {
          id: remote.purchase_units[0].payments.captures[0].id,
          status: captureStatus,
          amount: { ...remote.purchase_units[0].amount },
        };
      if (method === "POST" && path === "/v2/checkout/orders") {
        creates++;
        remote = {
          id: `PP${randomUUID().replaceAll("-", "")}`,
          intent: "CAPTURE",
          status: "CREATED",
          purchase_units: body.purchase_units,
          links: [
            {
              rel: "payer-action",
              href: "https://www.sandbox.paypal.com/checkoutnow?token=TEST",
            },
          ],
        };
      } else if (path.endsWith("/capture")) {
        captures++;
        remote.status = "COMPLETED";
        remote.purchase_units[0].payments = {
          captures: [
            {
              id: `CAP${randomUUID().replaceAll("-", "")}`,
              status: "COMPLETED",
              final_capture: true,
              amount: { ...remote.purchase_units[0].amount },
            },
          ],
        };
        if (loseCapture) {
          loseCapture = false;
          throw new PayPalFailure("PAYPAL_NETWORK");
        }
      }
      const output = structuredClone(remote);
      if (tamper) tamper(output);
      return output;
    },
  });
  const options = { env: paypalTestEnv, vault, api };
  return {
    ...f,
    merchant,
    credentials,
    options,
    state: {
      get captures() {
        return captures;
      },
      get creates() {
        return creates;
      },
      get remote() {
        return remote;
      },
      requestedMerchants,
      approve() {
        remote.status = "APPROVED";
      },
      loseNextCapture() {
        loseCapture = true;
      },
      tamper(fn: ((r: any) => void) | null) {
        tamper = fn;
      },
      rejectSignature() {
        signature = false;
      },
      acceptSignature() {
        signature = true;
      },
      refund() {
        captureStatus = "REFUNDED";
      },
    },
  };
}

test("PayPal preparation freezes server prices and reserves encrypted keys without assigning or creating an order", async () => {
  const db = authenticationDatabase();
  try {
    const f = await paypalFixture(db),
      payment = await preparePayPalCheckout(db, f.user.id, f.input, f.options);
    assert.equal(payment.status, "APPROVAL_PENDING");
    assert.equal(payment.amountCents, 2580);
    assert.equal(
      await db.keyReservation.count({ where: { checkoutId: payment.id } }),
      2,
    );
    assert.equal(
      await db.keyAssignment.count({ where: { productId: f.product.id } }),
      0,
    );
    assert.equal(await db.order.count({ where: { userId: f.user.id } }), 0);
    assert.equal(
      (await readCart(db, { userId: f.user.id })).products[0].availableStock,
      1,
    );
    assert.equal(
      (await preparePayPalCheckout(db, f.user.id, f.input, f.options)).id,
      payment.id,
    );
    assert.equal(f.state.creates, 1);
    await assert.rejects(
      preparePayPalCheckout(
        db,
        f.user.id,
        { ...f.input, discord: "changed.demo" },
        f.options,
      ),
      (e) => e instanceof CommerceFailure && e.code === "orderConflict",
    );
    const actor = await db.user.findUniqueOrThrow({
        where: { email: "catalog-admin@example.com" },
      }),
      reserved = await db.keyReservation.findFirstOrThrow({
        where: { checkoutId: payment.id },
      });
    await assert.rejects(
      changeKey(db, actor.id, reserved.keyId, { disabled: true }),
      (e) => e instanceof CommerceFailure && e.code === "keyReserved",
    );
  } finally {
    await db.$disconnect();
  }
});

test("PayPal refuses forged amounts, live mode, and another user’s payment references", async () => {
  const db = authenticationDatabase();
  try {
    const f = await paypalFixture(db);
    await assert.rejects(
      preparePayPalCheckout(
        db,
        f.user.id,
        { ...f.input, amount: 1 },
        f.options,
      ),
      (e) => e instanceof CommerceFailure && e.code === "invalidInput",
    );
    for (const env of [
      { ...paypalTestEnv, PAYPAL_ENV: "live" },
      { ...paypalTestEnv, APP_MODE: "commercial" },
      { ...paypalTestEnv, PAYPAL_CHECKOUT_ENABLED: "false" },
    ])
      await assert.rejects(
        preparePayPalCheckout(db, f.user.id, f.input, { ...f.options, env }),
        (e) => e instanceof CommerceFailure && e.code === "paypalUnavailable",
      );
    const payment = await preparePayPalCheckout(
        db,
        f.user.id,
        f.input,
        f.options,
      ),
      other = await checkoutFixture(db, 1, 1);
    await assert.rejects(
      readPayPalCheckout(db, other.user.id, payment.id),
      (e) => e instanceof CommerceFailure && e.status === 404,
    );
    await assert.rejects(
      reconcilePayPal(db, other.user.id, payment.id, f.options),
      (e) => e instanceof CommerceFailure && e.status === 404,
    );
    assert.equal(f.state.captures, 0);
  } finally {
    await db.$disconnect();
  }
});

test("PayPal captures only approved orders and delivers the original price snapshot exactly once", async () => {
  const db = authenticationDatabase();
  try {
    const f = await paypalFixture(db),
      p = await preparePayPalCheckout(db, f.user.id, f.input, f.options);
    await reconcilePayPal(db, f.user.id, p.id, f.options);
    assert.equal(f.state.captures, 0);
    await db.product.update({
      where: { id: f.product.id },
      data: {
        priceCents: 9999,
        translations: {
          update: {
            where: {
              productId_locale: { productId: f.product.id, locale: "FR" },
            },
            data: { name: "Edited after checkout" },
          },
        },
      },
    });
    f.state.approve();
    const result = await reconcilePayPal(db, f.user.id, p.id, f.options);
    assert.equal(result.status, "FULFILLED");
    assert.ok(result.orderId);
    const order = await orderDetails(
      db,
      f.user.id,
      result.orderId!,
      false,
      vault,
    );
    assert.equal(order.total, 2580);
    assert.equal(order.items[0].name.fr, "Nom figé");
    assert.equal(new Set(order.items[0].keys).size, 2);
    assert.equal(order.paypal?.status, "FULFILLED");
    await reconcilePayPal(db, f.user.id, p.id, f.options);
    assert.equal(f.state.captures, 1);
    assert.equal(
      await db.order.count({ where: { paypalCheckoutId: p.id } }),
      1,
    );
    assert.equal(
      await db.keyReservation.count({ where: { checkoutId: p.id } }),
      0,
    );
    // A cart whose prices changed after checkout is preserved rather than silently overwritten.
    assert.equal((await readCart(db, { userId: f.user.id })).items.length, 1);
  } finally {
    await db.$disconnect();
  }
});

test("a lost PayPal capture response is reconciled without charging or allocating twice", async () => {
  const db = authenticationDatabase();
  try {
    const f = await paypalFixture(db),
      p = await preparePayPalCheckout(db, f.user.id, f.input, f.options);
    f.state.approve();
    f.state.loseNextCapture();
    await assert.rejects(
      reconcilePayPal(db, f.user.id, p.id, f.options),
      (e) => e instanceof CommerceFailure && e.code === "paypalPending",
    );
    assert.equal(
      (await db.payPalCheckout.findUniqueOrThrow({ where: { id: p.id } }))
        .status,
      "CAPTURING",
    );
    assert.equal(
      await db.keyReservation.count({ where: { checkoutId: p.id } }),
      2,
    );
    assert.equal(await db.order.count({ where: { userId: f.user.id } }), 0);
    const result = await reconcilePayPal(db, f.user.id, p.id, f.options);
    assert.equal(result.status, "FULFILLED");
    assert.equal(f.state.captures, 1);
    assert.equal((await readCart(db, { userId: f.user.id })).items.length, 0);
  } finally {
    await db.$disconnect();
  }
});

for (const [name, tamper] of [
  [
    "merchant",
    (r: any) => {
      r.purchase_units[0].payee.merchant_id = "WRONG";
    },
  ],
  [
    "currency",
    (r: any) => {
      r.purchase_units[0].amount.currency_code = "USD";
    },
  ],
  [
    "amount",
    (r: any) => {
      r.purchase_units[0].amount.value = "0.01";
    },
  ],
  [
    "reference",
    (r: any) => {
      r.purchase_units[0].custom_id = "another-checkout";
    },
  ],
  [
    "split purchase units",
    (r: any) => {
      r.purchase_units.push(structuredClone(r.purchase_units[0]));
    },
  ],
] as const)
  test(`PayPal rejects a mismatched ${name} before capture or key delivery`, async () => {
    const db = authenticationDatabase();
    try {
      const f = await paypalFixture(db),
        p = await preparePayPalCheckout(db, f.user.id, f.input, f.options);
      f.state.approve();
      f.state.tamper(tamper);
      await assert.rejects(reconcilePayPal(db, f.user.id, p.id, f.options));
      assert.equal(f.state.captures, 0);
      assert.equal(await db.order.count({ where: { userId: f.user.id } }), 0);
      assert.equal(
        (await db.payPalCheckout.findUniqueOrThrow({ where: { id: p.id } }))
          .status,
        "NEEDS_REVIEW",
      );
    } finally {
      await db.$disconnect();
    }
  });

test("a new PayPal Business account never changes the recipient of an older pending payment", async () => {
  const db = authenticationDatabase();
  try {
    const f = await paypalFixture(db),
      p = await preparePayPalCheckout(db, f.user.id, f.input, f.options);
    const next = await activateMerchant(
      db,
      {
        clientId: "new-client-" + randomUUID(),
        secret: "new-secret-" + randomUUID(),
      },
      "NEXTMERCHANT",
      "Next account",
      vault,
    );
    assert.notEqual(next.id, f.merchant.id);
    assert.ok(
      (
        await db.payPalMerchant.findUniqueOrThrow({
          where: { id: f.merchant.id },
        })
      ).retiredAt,
    );
    f.state.approve();
    const result = await reconcilePayPal(db, f.user.id, p.id, f.options);
    assert.equal(result.status, "FULFILLED");
    assert.ok(f.state.requestedMerchants.every((id) => id === f.merchant.id));
    const archived = await db.payPalMerchant.findUniqueOrThrow({
      where: { id: f.merchant.id },
    });
    assert.deepEqual(openMerchant(archived, vault), f.credentials);
    assert.ok(!archived.credentialsCiphertext.includes(f.credentials.secret));
    f.state.refund();
    assert.equal(
      (await reconcilePayPal(db, f.user.id, p.id, f.options)).status,
      "REFUNDED",
    );
    assert.equal(
      await db.keyAssignment.count({ where: { productId: f.product.id } }),
      2,
    );
  } finally {
    await db.$disconnect();
  }
});

test("canceled and expired PayPal checkouts release reservations and keep the cart", async () => {
  const db = authenticationDatabase();
  try {
    const f = await paypalFixture(db, 1, 1),
      p = await preparePayPalCheckout(db, f.user.id, f.input, f.options);
    const canceled = await reconcilePayPal(
      db,
      f.user.id,
      p.id,
      f.options,
      true,
    );
    assert.equal(canceled.status, "CANCELED");
    assert.equal(
      await db.keyReservation.count({ where: { checkoutId: p.id } }),
      0,
    );
    assert.equal((await readCart(db, { userId: f.user.id })).items.length, 1);
    const old = await db.payPalCheckout.findUniqueOrThrow({
        where: { id: p.id },
      }),
      id = randomUUID();
    await db.payPalCheckout.create({
      data: {
        ...old,
        id,
        idempotencyKey: randomUUID(),
        status: "APPROVAL_PENDING",
        paypalOrderId: null,
        captureId: null,
        expiresAt: new Date(Date.now() - 60000),
        snapshot: old.snapshot as any,
        requestBody: old.requestBody as any,
      },
    });
    const key = await db.activationKey.findFirstOrThrow({
      where: { productId: f.product.id },
    });
    await db.keyReservation.create({
      data: {
        keyId: key.id,
        checkoutId: id,
        productId: f.product.id,
        unitIndex: 1,
      },
    });
    await expireCheckout(db, id);
    assert.equal(
      (await db.payPalCheckout.findUniqueOrThrow({ where: { id } })).status,
      "EXPIRED",
    );
    assert.equal(
      await db.keyReservation.count({ where: { checkoutId: id } }),
      0,
    );
  } finally {
    await db.$disconnect();
  }
});

test("two buyers cannot reserve the same last key while PayPal approval is pending", async () => {
  const db = authenticationDatabase(),
    otherDb = authenticationDatabase();
  try {
    const f = await paypalFixture(db, 1, 1),
      other = await db.user.create({
        data: {
          email: `paypal-racer-${randomUUID()}@example.com`,
          passwordHash: await passwordHash(passphrase),
        },
      });
    await mutateCart(
      db,
      { userId: other.id },
      { operation: "add", productId: f.product.id, quantity: 1 },
    );
    const cart = await readCart(db, { userId: other.id });
    const results = await Promise.allSettled([
      preparePayPalCheckout(db, f.user.id, f.input, f.options),
      preparePayPalCheckout(
        otherDb,
        other.id,
        {
          ...f.input,
          idempotencyKey: randomUUID(),
          cartRevision: cart.revision,
          cartFingerprint: cart.fingerprint,
        },
        f.options,
      ),
    ]);
    assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
    assert.equal(
      await db.keyReservation.count({ where: { productId: f.product.id } }),
      1,
    );
    assert.equal(
      await db.keyAssignment.count({ where: { productId: f.product.id } }),
      0,
    );
  } finally {
    await db.$disconnect();
    await otherDb.$disconnect();
  }
});

test("a duplicate signed webhook is processed once and an invalid signature cannot deliver keys", async () => {
  const db = authenticationDatabase();
  try {
    const f = await paypalFixture(db),
      p = await preparePayPalCheckout(db, f.user.id, f.input, f.options);
    f.state.approve();
    const event = {
        id: "EVT-" + randomUUID(),
        event_type: "CHECKOUT.ORDER.APPROVED",
        resource: { id: f.state.remote.id },
      },
      headers = new Headers({
        "paypal-transmission-id": randomUUID(),
        "paypal-transmission-time": new Date().toISOString(),
        "paypal-transmission-sig": "signature",
        "paypal-cert-url":
          "https://api.sandbox.paypal.com/v1/notifications/certs/CERT-TEST",
        "paypal-auth-algo": "SHA256withRSA",
      });
    f.state.rejectSignature();
    await assert.rejects(
      processPayPalWebhook(db, f.merchant.id, headers, event, f.options),
      (e) => e instanceof CommerceFailure && e.status === 403,
    );
    assert.equal(
      await db.payPalWebhookEvent.count({ where: { id: event.id } }),
      0,
    );
    f.state.acceptSignature();
    await processPayPalWebhook(db, f.merchant.id, headers, event, f.options);
    await processPayPalWebhook(db, f.merchant.id, headers, event, f.options);
    assert.equal(f.state.captures, 1);
    assert.equal(
      await db.order.count({ where: { paypalCheckoutId: p.id } }),
      1,
    );
  } finally {
    await db.$disconnect();
  }
});

test("a SQL error after PayPal capture rolls back key delivery and can resume without a second capture", async () => {
  const db = authenticationDatabase();
  let trigger = false;
  try {
    const f = await paypalFixture(db),
      p = await preparePayPalCheckout(db, f.user.id, f.input, f.options);
    f.state.approve();
    await admin.query(
      `CREATE FUNCTION "test_abort_paypal_delivery"() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW."productId"='${f.product.id}' AND NEW."unitIndex"=2 THEN RAISE EXCEPTION 'test delivery failure'; END IF; RETURN NEW; END $$`,
    );
    await admin.query(
      `CREATE TRIGGER "test_abort_paypal_delivery" BEFORE INSERT ON "KeyAssignment" FOR EACH ROW EXECUTE FUNCTION "test_abort_paypal_delivery"()`,
    );
    trigger = true;
    await assert.rejects(reconcilePayPal(db, f.user.id, p.id, f.options));
    assert.equal(f.state.captures, 1);
    assert.equal(
      (await db.payPalCheckout.findUniqueOrThrow({ where: { id: p.id } }))
        .status,
      "VERIFIED",
    );
    assert.equal(
      await db.order.count({ where: { paypalCheckoutId: p.id } }),
      0,
    );
    assert.equal(
      await db.keyAssignment.count({ where: { productId: f.product.id } }),
      0,
    );
    assert.equal(
      await db.keyReservation.count({ where: { checkoutId: p.id } }),
      2,
    );
    await admin.query(
      `DROP TRIGGER "test_abort_paypal_delivery" ON "KeyAssignment"`,
    );
    trigger = false;
    assert.equal(
      (await reconcilePayPal(db, f.user.id, p.id, f.options)).status,
      "FULFILLED",
    );
    assert.equal(f.state.captures, 1);
  } finally {
    if (trigger)
      await admin.query(
        `DROP TRIGGER "test_abort_paypal_delivery" ON "KeyAssignment"`,
      );
    await admin.query(`DROP FUNCTION IF EXISTS "test_abort_paypal_delivery"()`);
    await db.$disconnect();
  }
});

test("concurrent PayPal return callbacks allocate and capture only once", async () => {
  const db = authenticationDatabase(),
    other = authenticationDatabase();
  try {
    const f = await paypalFixture(db),
      p = await preparePayPalCheckout(db, f.user.id, f.input, f.options);
    f.state.approve();
    const results = await Promise.allSettled([
      reconcilePayPal(db, f.user.id, p.id, f.options),
      reconcilePayPal(other, f.user.id, p.id, f.options),
    ]);
    assert.ok(results.some((r) => r.status === "fulfilled"));
    assert.equal(f.state.captures, 1);
    assert.equal(
      await db.order.count({ where: { paypalCheckoutId: p.id } }),
      1,
    );
    assert.equal(
      await db.keyAssignment.count({ where: { productId: f.product.id } }),
      2,
    );
  } finally {
    await db.$disconnect();
    await other.$disconnect();
  }
});

test("canceling an approved but uncaptured PayPal order does not charge the buyer", async () => {
  const db = authenticationDatabase();
  try {
    const f = await paypalFixture(db),
      p = await preparePayPalCheckout(db, f.user.id, f.input, f.options);
    f.state.approve();
    const result = await reconcilePayPal(db, f.user.id, p.id, f.options, true);
    assert.equal(result.status, "CANCELED");
    assert.equal(f.state.captures, 0);
    assert.equal(
      await db.keyReservation.count({ where: { checkoutId: p.id } }),
      0,
    );
  } finally {
    await db.$disconnect();
  }
});

for (const parentHost of [
  "api.sandbox.paypal.com",
  "api-m.sandbox.paypal.com",
]) {
  test(`refund notification resolves its parent capture on ${parentHost} and preserves delivered keys`, async () => {
    const db = authenticationDatabase();
    try {
      const f = await paypalFixture(db);
      const p = await preparePayPalCheckout(db, f.user.id, f.input, f.options);
      f.state.approve();
      const paid = await reconcilePayPal(db, f.user.id, p.id, f.options);
      const checkout = await db.payPalCheckout.findUniqueOrThrow({
        where: { id: p.id },
      });
      f.state.refund();
      const event = {
        id: "EVT-" + randomUUID(),
        event_type: "PAYMENT.CAPTURE.REFUNDED",
        resource: {
          id: "REFUND-" + randomUUID(),
          links: [
            {
              rel: "up",
              href: `https://${parentHost}/v2/payments/captures/${checkout.captureId}`,
            },
          ],
        },
      };
      const headers = new Headers({
        "paypal-transmission-id": randomUUID(),
        "paypal-transmission-time": new Date().toISOString(),
        "paypal-transmission-sig": "signature",
        "paypal-cert-url":
          "https://api.sandbox.paypal.com/v1/notifications/certs/CERT-TEST",
        "paypal-auth-algo": "SHA256withRSA",
      });
      await processPayPalWebhook(db, f.merchant.id, headers, event, f.options);
      await processPayPalWebhook(db, f.merchant.id, headers, event, f.options);
      assert.equal(
        (await readPayPalCheckout(db, f.user.id, p.id)).status,
        "REFUNDED",
      );
      assert.equal(
        await db.order.count({ where: { paypalCheckoutId: p.id } }),
        1,
      );
      assert.equal(
        await db.keyAssignment.count({
          where: { orderItem: { orderId: paid.orderId! } },
        }),
        2,
      );
      assert.equal(f.state.captures, 1);
    } finally {
      await db.$disconnect();
    }
  });
}

for (const captureStarted of [false, true]) {
  test(`expiration retains keys for ${captureStarted ? "an uncertain capture" : "an active creation lease"}`, async () => {
    const db = authenticationDatabase();
    try {
      const f = await paypalFixture(db, 1, 1);
      const p = await preparePayPalCheckout(db, f.user.id, f.input, f.options);
      await reconcilePayPal(db, f.user.id, p.id, f.options, true);
      const old = await db.payPalCheckout.findUniqueOrThrow({
        where: { id: p.id },
      });
      const id = randomUUID();
      const token = randomUUID();
      await db.payPalCheckout.create({
        data: {
          ...old,
          id,
          idempotencyKey: randomUUID(),
          paypalOrderId: null,
          status: "CREATING",
          expiresAt: new Date(Date.now() - 60000),
          captureStartedAt: captureStarted ? new Date() : null,
          leaseToken: token,
          leaseUntil: new Date(Date.now() + 60000),
          snapshot: old.snapshot as any,
          requestBody: old.requestBody as any,
        },
      });
      const key = await db.activationKey.findFirstOrThrow({
        where: { productId: f.product.id },
      });
      await db.keyReservation.create({
        data: {
          keyId: key.id,
          checkoutId: id,
          productId: f.product.id,
          unitIndex: 1,
        },
      });
      await expireCheckout(db, id);
      assert.equal(
        (await db.payPalCheckout.findUniqueOrThrow({ where: { id } })).status,
        "CREATING",
      );
      assert.equal(
        await db.keyReservation.count({ where: { checkoutId: id } }),
        1,
      );
      if (!captureStarted) {
        await expireCheckout(db, id, token);
        assert.equal(
          (await db.payPalCheckout.findUniqueOrThrow({ where: { id } })).status,
          "EXPIRED",
        );
        assert.equal(
          await db.keyReservation.count({ where: { checkoutId: id } }),
          0,
        );
      } else {
        await db.payPalCheckout.update({
          where: { id },
          data: { leaseUntil: new Date(Date.now() - 1000) },
        });
        await expireCheckout(db, id);
        assert.equal(
          await db.keyReservation.count({ where: { checkoutId: id } }),
          1,
        );
      }
    } finally {
      await db.$disconnect();
    }
  });
}

for (const invalid of ["parent host", "capture amount"]) {
  test(`refund notification cannot update a payment with an invalid ${invalid}`, async () => {
    const db = authenticationDatabase();
    try {
      const f = await paypalFixture(db);
      const p = await preparePayPalCheckout(db, f.user.id, f.input, f.options);
      f.state.approve();
      await reconcilePayPal(db, f.user.id, p.id, f.options);
      const row = await db.payPalCheckout.findUniqueOrThrow({
        where: { id: p.id },
      });
      f.state.refund();
      const api = f.options.api;
      let captureReads = 0;
      const options = {
        ...f.options,
        api: (merchantId: string): PayPalAPI => ({
          async request(path, method, body, requestId) {
            const result: any = await api(merchantId).request(
              path,
              method,
              body,
              requestId,
            );
            if (path.startsWith("/v2/payments/captures/")) {
              captureReads++;
              if (invalid === "capture amount") result.amount.value = "0.01";
            }
            return result;
          },
        }),
      };
      const event = {
        id: "EVT-" + randomUUID(),
        event_type: "PAYMENT.CAPTURE.REFUNDED",
        resource: {
          id: "REFUND-" + randomUUID(),
          links: [
            {
              rel: "up",
              href: `https://${invalid === "parent host" ? "attacker.invalid" : "api.sandbox.paypal.com"}/v2/payments/captures/${row.captureId}`,
            },
          ],
        },
      };
      const headers = new Headers({
        "paypal-transmission-id": randomUUID(),
        "paypal-transmission-time": new Date().toISOString(),
        "paypal-transmission-sig": "signature",
        "paypal-auth-algo": "SHA256withRSA",
        "paypal-cert-url":
          "https://api.sandbox.paypal.com/v1/notifications/certs/CERT-TEST",
      });
      if (invalid === "capture amount") {
        await assert.rejects(
          processPayPalWebhook(db, f.merchant.id, headers, event, options),
          (e) => e instanceof CommerceFailure && e.code === "paypalReview",
        );
        assert.equal(
          (
            await db.payPalWebhookEvent.findUniqueOrThrow({
              where: { id: event.id },
            })
          ).processedAt,
          null,
        );
        assert.equal(captureReads, 1);
      } else {
        await processPayPalWebhook(db, f.merchant.id, headers, event, options);
        assert.equal(captureReads, 0);
      }
      assert.equal(
        (await readPayPalCheckout(db, f.user.id, p.id)).status,
        "FULFILLED",
      );
    } finally {
      await db.$disconnect();
    }
  });
}
