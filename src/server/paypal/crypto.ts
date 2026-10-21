import {
  createCipheriv,
  createDecipheriv,
  hkdfSync,
  randomBytes,
  createHmac,
} from "node:crypto";
import type { KeyVaultConfig } from "../security/key-vault.ts";
function derived(v: KeyVaultConfig) {
  return Buffer.from(
    hkdfSync(
      "sha256",
      v.encryptionKey,
      Buffer.from("unlock-all:paypal"),
      Buffer.from("merchant-v1"),
      32,
    ),
  );
}
export function sealMerchant(
  id: string,
  credentials: { clientId: string; secret: string },
  v: KeyVaultConfig,
) {
  const iv = randomBytes(12),
    cipher = createCipheriv("aes-256-gcm", derived(v), iv);
  cipher.setAAD(Buffer.from(`paypal:${id}:${v.keyId}`));
  const encrypted = Buffer.concat([
    cipher.update(JSON.stringify(credentials), "utf8"),
    cipher.final(),
  ]);
  return {
    credentialsCiphertext: [
      "v1",
      iv.toString("base64url"),
      cipher.getAuthTag().toString("base64url"),
      encrypted.toString("base64url"),
    ].join("."),
    encryptionKeyId: v.keyId,
    fingerprint: createHmac("sha256", v.fingerprintSecret)
      .update(credentials.clientId)
      .digest("hex"),
  };
}
export function openMerchant(
  record: {
    id: string;
    credentialsCiphertext: string;
    encryptionKeyId: string;
  },
  v: KeyVaultConfig,
): { clientId: string; secret: string } {
  if (record.encryptionKeyId !== v.keyId)
    throw new Error("Merchant encryption key unavailable");
  const [version, iv, tag, data] = record.credentialsCiphertext.split(".");
  if (version !== "v1" || !data) throw new Error("Invalid merchant envelope");
  const cipher = createDecipheriv(
    "aes-256-gcm",
    derived(v),
    Buffer.from(iv, "base64url"),
  );
  cipher.setAAD(Buffer.from(`paypal:${record.id}:${v.keyId}`));
  cipher.setAuthTag(Buffer.from(tag, "base64url"));
  return JSON.parse(
    Buffer.concat([
      cipher.update(Buffer.from(data, "base64url")),
      cipher.final(),
    ]).toString("utf8"),
  );
}
