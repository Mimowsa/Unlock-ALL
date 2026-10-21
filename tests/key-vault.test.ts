import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import {
  sealKey,
  openKey,
  keyVaultConfig,
  type KeyVaultConfig,
} from "../src/server/security/key-vault.ts";
import { assertDemoSeedAllowed } from "../src/server/db/demo-seed-policy.ts";
const vault: KeyVaultConfig = {
  encryptionKey: randomBytes(32),
  fingerprintSecret: randomBytes(32),
  keyId: "test-v1",
};
test("keys are encrypted with independent nonces and a stable uniqueness fingerprint", () => {
  const a = sealKey("DEMO-TEST-001", vault);
  const b = sealKey("DEMO-TEST-001", vault);
  assert.notEqual(a.ciphertext, b.ciphertext);
  assert.equal(a.fingerprint, b.fingerprint);
  assert.ok(!a.ciphertext.includes("DEMO-TEST-001"));
  assert.equal(openKey(a, vault), "DEMO-TEST-001");
});
test("authenticated encryption rejects tampering, wrong secrets and key versions", () => {
  const record = sealKey("DEMO-TEST-001", vault);
  const parts = record.ciphertext.split(".");
  const data = Buffer.from(parts[3], "base64url");
  data[0] ^= 1;
  parts[3] = data.toString("base64url");
  assert.throws(() =>
    openKey({ ...record, ciphertext: parts.join(".") }, vault),
  );
  assert.throws(() =>
    openKey(record, { ...vault, encryptionKey: randomBytes(32) }),
  );
  assert.throws(() => openKey(record, { ...vault, keyId: "wrong-version" }));
});
test("invalid encryption configuration is rejected without echoing secrets", () => {
  assert.throws(() =>
    keyVaultConfig({
      ACTIVATION_KEY_KEY_ID: "test",
      ACTIVATION_KEY_ENCRYPTION_KEY: "invalid",
    }),
  );
  assert.throws(() =>
    keyVaultConfig({
      ACTIVATION_KEY_KEY_ID: "test",
      ACTIVATION_KEY_ENCRYPTION_KEY: "a".repeat(64),
      ACTIVATION_KEY_FINGERPRINT_SECRET: "a".repeat(64),
    }),
  );
  assert.throws(() => sealKey("  DEMO-TEST  ", vault));
  assert.throws(() =>
    openKey(
      { ciphertext: "not-an-envelope", encryptionKeyId: vault.keyId },
      vault,
    ),
  );
});
test("demo seeding requires explicit opt-in and cannot run in production", () => {
  const allowed = { APP_MODE: "demo", DEMO_SEED_ENABLED: "true" };
  assert.doesNotThrow(() => assertDemoSeedAllowed(allowed));
  for (const env of [
    {},
    { ...allowed, DEMO_SEED_ENABLED: "false" },
    { ...allowed, APP_MODE: "commercial" },
    { ...allowed, NODE_ENV: "production" },
    { ...allowed, VERCEL_ENV: "production" },
  ])
    assert.throws(() => assertDemoSeedAllowed(env));
});
