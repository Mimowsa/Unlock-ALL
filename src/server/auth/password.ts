import { hash, verify, argon2id } from "argon2";
export const passwordHash = (password: string) =>
  hash(password, {
    type: argon2id,
    memoryCost: 65536,
    timeCost: 3,
    parallelism: 1,
  });
let dummy: Promise<string> | undefined;
export async function passwordMatches(stored: string | null, password: string) {
  const timingHash = await (dummy ??= passwordHash(
    "unlock-all-unknown-account-timing-placeholder",
  ));
  const encoded = stored || timingHash;
  try {
    return (await verify(encoded, password)) && stored !== null;
  } catch {
    return false;
  }
}
