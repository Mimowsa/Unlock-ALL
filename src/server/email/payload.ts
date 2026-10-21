import {
  createCipheriv,
  createDecipheriv,
  hkdfSync,
  randomBytes,
} from "node:crypto";
import type { KeyVaultConfig } from "../security/key-vault.ts";
export type EmailPayload = {
  from: string;
  to: string[];
  subject: string;
  html: string;
  text: string;
};
function key(vault: KeyVaultConfig) {
  return Buffer.from(
    hkdfSync(
      "sha256",
      vault.encryptionKey,
      Buffer.from("unlock-all:email"),
      Buffer.from("payload-v1"),
      32,
    ),
  );
}
export function sealPayload(
  id: string,
  payload: EmailPayload,
  vault: KeyVaultConfig,
) {
  const iv = randomBytes(12),
    cipher = createCipheriv("aes-256-gcm", key(vault), iv);
  cipher.setAAD(Buffer.from(`unlock-all:email:${vault.keyId}:${id}`));
  const body = Buffer.concat([
    cipher.update(JSON.stringify(payload), "utf8"),
    cipher.final(),
  ]);
  return {
    payloadCiphertext: [
      "v1",
      iv.toString("base64url"),
      cipher.getAuthTag().toString("base64url"),
      body.toString("base64url"),
    ].join("."),
    payloadKeyId: vault.keyId,
  };
}
export function openPayload(
  id: string,
  record: { payloadCiphertext: string; payloadKeyId: string },
  vault: KeyVaultConfig,
): EmailPayload {
  if (record.payloadKeyId !== vault.keyId)
    throw new Error("Email payload key unavailable");
  const [version, iv, tag, body, ...rest] = record.payloadCiphertext.split(".");
  if (
    version !== "v1" ||
    !body ||
    rest.length ||
    Buffer.from(iv, "base64url").length !== 12 ||
    Buffer.from(tag, "base64url").length !== 16
  )
    throw new Error("Invalid email payload");
  const cipher = createDecipheriv(
    "aes-256-gcm",
    key(vault),
    Buffer.from(iv, "base64url"),
  );
  cipher.setAAD(Buffer.from(`unlock-all:email:${vault.keyId}:${id}`));
  cipher.setAuthTag(Buffer.from(tag, "base64url"));
  return JSON.parse(
    Buffer.concat([
      cipher.update(Buffer.from(body, "base64url")),
      cipher.final(),
    ]).toString("utf8"),
  );
}
