import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
} from "node:crypto";
export type KeyVaultConfig = {
  encryptionKey: Buffer;
  fingerprintSecret: Buffer;
  keyId: string;
};
function secret(value: string | undefined, name: string) {
  if (!value || !/^[a-fA-F0-9]{64}$/.test(value))
    throw new Error(
      `${name} must contain 32 random bytes encoded as 64 hexadecimal characters.`,
    );
  return Buffer.from(value, "hex");
}
export function keyVaultConfig(
  env: Readonly<Record<string, string | undefined>> = process.env,
): KeyVaultConfig {
  const keyId = env.ACTIVATION_KEY_KEY_ID;
  if (!keyId || !/^[a-zA-Z0-9_-]{1,40}$/.test(keyId))
    throw new Error("ACTIVATION_KEY_KEY_ID is required.");
  const encryptionKey = secret(
    env.ACTIVATION_KEY_ENCRYPTION_KEY,
    "ACTIVATION_KEY_ENCRYPTION_KEY",
  );
  const fingerprintSecret = secret(
    env.ACTIVATION_KEY_FINGERPRINT_SECRET,
    "ACTIVATION_KEY_FINGERPRINT_SECRET",
  );
  if (encryptionKey.equals(fingerprintSecret))
    throw new Error("Encryption and fingerprint secrets must be independent.");
  return { encryptionKey, fingerprintSecret, keyId };
}
export function sealKey(value: string, config: KeyVaultConfig) {
  if (!value.trim() || value !== value.trim())
    throw new Error("Activation keys must be non-empty and trimmed.");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", config.encryptionKey, iv);
  cipher.setAAD(Buffer.from(`unlock-all:activation-key:${config.keyId}`));
  const encrypted = Buffer.concat([
    cipher.update(value, "utf8"),
    cipher.final(),
  ]);
  return {
    ciphertext: [
      "v1",
      iv.toString("base64url"),
      cipher.getAuthTag().toString("base64url"),
      encrypted.toString("base64url"),
    ].join("."),
    fingerprint: createHmac("sha256", config.fingerprintSecret)
      .update(value, "utf8")
      .digest("hex"),
    encryptionKeyId: config.keyId,
  };
}
export function openKey(
  record: { ciphertext: string; encryptionKeyId: string },
  config: KeyVaultConfig,
) {
  if (record.encryptionKeyId !== config.keyId)
    throw new Error("The encryption key version is not available.");
  const parts = record.ciphertext.split(".");
  if (
    parts.length !== 4 ||
    parts[0] !== "v1" ||
    parts.slice(1).some((p) => !/^[a-zA-Z0-9_-]+$/.test(p))
  )
    throw new Error("Invalid encrypted activation key.");
  const iv = Buffer.from(parts[1], "base64url");
  const tag = Buffer.from(parts[2], "base64url");
  if (iv.length !== 12 || tag.length !== 16)
    throw new Error("Invalid encrypted activation key.");
  const decipher = createDecipheriv("aes-256-gcm", config.encryptionKey, iv);
  decipher.setAAD(Buffer.from(`unlock-all:activation-key:${config.keyId}`));
  decipher.setAuthTag(tag);
  return Buffer.concat([
    decipher.update(Buffer.from(parts[3], "base64url")),
    decipher.final(),
  ]).toString("utf8");
}
