"use client";
import { SessionProvider, useSession, signOut } from "next-auth/react";
import { useRouter } from "next/navigation";
import type { ReactNode } from "react";
import { useLocale } from "next-intl";
export function AuthSessionProvider({ children }: { children: ReactNode }) {
  return (
    <SessionProvider refetchInterval={60} refetchOnWindowFocus>
      {children}
    </SessionProvider>
  );
}
export function useIdentity() {
  const { data, status, update } = useSession();
  const router = useRouter();
  const locale = useLocale();
  return {
    user: data?.user ?? null,
    // Keep mounted forms during a session refresh; only the initial load blocks.
    loading: status === "loading" && !data,
    refresh: update,
    async signOut() {
      await signOut({ redirect: false });
      router.replace(`/${locale}/connexion`);
      router.refresh();
    },
  };
}
