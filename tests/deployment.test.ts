import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  deploymentIssues,
  hostedDatabaseUrls,
} from "../src/server/deployment/config.ts";
import { jobAuthorization } from "../src/server/jobs/authorization.ts";
import { handleJob } from "../src/server/jobs/handler.ts";
import { createImageStorage } from "../src/server/media/image-storage.ts";
const valid = () => ({
  APP_MODE: "demo",
  DATABASE_URL:
    "postgresql://user:private@ep-demo-pooler.eu.aws.neon.tech/demo?sslmode=require",
  DIRECT_URL:
    "postgresql://user:private@ep-demo.eu.aws.neon.tech/demo?sslmode=require",
  NEXTAUTH_URL: "https://unlock.example.test",
  NEXTAUTH_SECRET: randomBytes(48).toString("hex"),
  ACTIVATION_KEY_KEY_ID: "test",
  ACTIVATION_KEY_ENCRYPTION_KEY: randomBytes(32).toString("hex"),
  ACTIVATION_KEY_FINGERPRINT_SECRET: randomBytes(32).toString("hex"),
  PRODUCT_IMAGE_STORAGE: "vercel-blob",
  BLOB_READ_WRITE_TOKEN: "vercel_blob_rw_TEST_ONLY",
  AUTH_RESET_DELIVERY: "none",
  EMAIL_DELIVERY: "none",
  PAYPAL_ENV: "sandbox",
  BACKGROUND_JOBS_ENABLED: "true",
  CRON_SECRET: randomBytes(32).toString("hex"),
  SCHEDULER_MODE: "external",
});
test("hosted configuration requires HTTPS, isolated Neon, persistent images and protected workers", () => {
  assert.deepEqual(deploymentIssues(valid()), []);
  const reused = valid();
  assert.ok(
    deploymentIssues({
      ...reused,
      CRON_SECRET: reused.ACTIVATION_KEY_ENCRYPTION_KEY,
    }).length,
  );
  for (const patch of [
    { APP_MODE: "commercial" },
    { NEXTAUTH_URL: "http://localhost:3000" },
    { PRODUCT_IMAGE_STORAGE: "local" },
    { AUTH_RESET_DELIVERY: "local" },
    { PAYPAL_ENV: "live" },
    { DEMO_SEED_ENABLED: "true" },
    { CRON_SECRET: "short" },
    { BACKGROUND_JOBS_ENABLED: "false" },
    { EMAIL_DELIVERY: "anything" },
  ])
    assert.ok(deploymentIssues({ ...valid(), ...patch }).length);
});
test("Neon connection pairs reject mismatched databases, credentials, TLS and session options", () => {
  for (const direct of [
    "postgresql://user:private@ep-other.eu.aws.neon.tech/demo?sslmode=require",
    "postgresql://user:private@ep-demo.eu.aws.neon.tech/other?sslmode=require",
    "postgresql://user:different@ep-demo.eu.aws.neon.tech/demo?sslmode=require",
    "postgresql://user:private@ep-demo.eu.aws.neon.tech/demo",
    "postgresql://user:private@ep-demo.eu.aws.neon.tech/demo?sslmode=require&options=bad",
  ])
    assert.throws(() => hostedDatabaseUrls({ ...valid(), DIRECT_URL: direct }));
  const env = valid();
  const issues = deploymentIssues({
    ...env,
    DIRECT_URL: "postgresql://user:SECRET-NEVER-LOG@localhost/demo",
  });
  assert.ok(!JSON.stringify(issues).includes("SECRET-NEVER-LOG"));
});
test("background jobs fail closed without secrets and reject forged authorization", () => {
  const env = valid();
  for (const header of [
    "",
    "Bearer wrong",
    `Basic ${env.CRON_SECRET}`,
    `Bearer ${env.CRON_SECRET.slice(1)}`,
  ])
    assert.equal(
      jobAuthorization(
        new Request("https://test/jobs", {
          headers: { authorization: header },
        }),
        env,
      ),
      401,
    );
  const request = new Request("https://test/jobs", {
    headers: { authorization: `Bearer ${env.CRON_SECRET}` },
  });
  assert.equal(jobAuthorization(request, env), 200);
  assert.equal(
    jobAuthorization(request, { ...env, BACKGROUND_JOBS_ENABLED: "false" }),
    503,
  );
  assert.equal(jobAuthorization(request, { ...env, CRON_SECRET: "" }), 503);
});
test("an unauthorized scheduler invocation never executes work or touches the database", async () => {
  let calls = 0;
  const response = await handleJob(
    new Request("https://test/jobs"),
    async () => {
      calls++;
      return {};
    },
  );
  assert.ok([401, 503].includes(response.status));
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(calls, 0);
});
test("local images remain readable across storage instances and cannot escape their directory", async () => {
  const dir = await mkdtemp(join(tmpdir(), "unlock-storage-"));
  try {
    const env = { PRODUCT_IMAGE_STORAGE: "local", PRODUCT_IMAGES_DIR: dir };
    const filename = `${randomUUID()}.webp`;
    const store = createImageStorage(env);
    await store.write(filename, Buffer.from("normalized-test-image"));
    assert.deepEqual(
      await createImageStorage(env).read(filename),
      Buffer.from("normalized-test-image"),
    );
    assert.equal(await store.exists(filename), true);
    await assert.rejects(store.read("../../.env"));
    await store.delete(filename);
    assert.equal(await store.read(filename), null);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
test("Vercel refuses ephemeral image storage or a cloud store without credentials", () => {
  assert.throws(() => createImageStorage({ VERCEL: "1" }));
  assert.throws(() =>
    createImageStorage({ VERCEL: "1", PRODUCT_IMAGE_STORAGE: "local" }),
  );
  assert.throws(() =>
    createImageStorage({ PRODUCT_IMAGE_STORAGE: "vercel-blob" }),
  );
});
test("private Blob keeps stable application URLs and sends credentials only to the SDK", async () => {
  const filename = `${randomUUID()}.webp`,
    path = `product-images/${filename}`;
  const bytes = Buffer.from("normalized-image");
  const calls: string[] = [];
  let stored: Buffer | null = null;
  const fake = {
    async put(name: string, body: Buffer, options: any) {
      assert.equal(name, path);
      assert.equal(options.access, "private");
      assert.equal(options.addRandomSuffix, false);
      assert.equal(options.allowOverwrite, false);
      stored = body;
      calls.push("put");
    },
    async head(name: string) {
      assert.equal(name, path);
      return { pathname: path, contentType: "image/webp", size: bytes.length };
    },
    async get(name: string, options: any) {
      assert.equal(name, path);
      assert.equal(options.access, "private");
      calls.push("get");
      return stored
        ? {
            statusCode: 200,
            stream: new Response(new Uint8Array(stored)).body,
            blob: { contentType: "image/webp", size: stored.length },
          }
        : null;
    },
    async del(name: string) {
      assert.equal(name, path);
      stored = null;
      calls.push("del");
    },
  };
  const store = createImageStorage(
    {
      PRODUCT_IMAGE_STORAGE: "vercel-blob",
      BLOB_READ_WRITE_TOKEN: "private-token",
    },
    fake as any,
  );
  await store.write(filename, bytes);
  assert.equal(await store.exists(filename), true);
  assert.deepEqual(await store.read(filename), bytes);
  await store.delete(filename);
  assert.equal(await store.read(filename), null);
  assert.deepEqual(calls, ["put", "get", "del", "get"]);
});
test("Blob errors are not disguised as absent images, and oversized content is rejected", async () => {
  const filename = `${randomUUID()}.webp`;
  const store = createImageStorage(
    { PRODUCT_IMAGE_STORAGE: "vercel-blob", BLOB_READ_WRITE_TOKEN: "private" },
    {
      async get() {
        throw new Error("provider unavailable");
      },
    } as any,
  );
  await assert.rejects(store.read(filename));
  await assert.rejects(
    store.write(filename, Buffer.alloc(5 * 1024 * 1024 + 1)),
  );
});
