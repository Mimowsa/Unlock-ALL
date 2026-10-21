import type { ReactNode } from "react";
import { requireUser } from "@/server/auth/current-user";
import { DemoPage } from "./demo-page";
export async function ProtectedDemoPage({
  children,
  locale,
  next = "compte",
  admin = false,
}: {
  children: ReactNode;
  locale: string;
  next?: string;
  admin?: boolean;
}) {
  await requireUser(locale, next, admin);
  return <DemoPage>{children}</DemoPage>;
}
