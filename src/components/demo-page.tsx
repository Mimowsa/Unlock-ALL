import { Suspense, type ReactNode } from "react";
import Loading from "@/app/[locale]/loading";
export function DemoPage({ children }: { children: ReactNode }) {
  return <Suspense fallback={<Loading />}>{children}</Suspense>;
}
