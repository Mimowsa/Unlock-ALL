import "server-only";
import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "./options";
import { authSecret, authOrigin } from "./config";
export async function currentUser() {
  authSecret();
  authOrigin();
  return (await getServerSession(authOptions))?.user ?? null;
}
export async function requireUser(
  locale: string,
  next = "compte",
  admin = false,
) {
  const user = await currentUser();
  if (!user) redirect(`/${locale}/connexion?next=${encodeURIComponent(next)}`);
  if (admin && user.role !== "ADMIN") redirect(`/${locale}/compte?denied=1`);
  return user;
}
