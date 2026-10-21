import type { DefaultSession } from "next-auth";
declare module "next-auth" {
  interface User {
    sessionVersion: number;
  }
  interface Session {
    user: NonNullable<DefaultSession["user"]> & {
      id: string;
      email: string;
      role: "USER" | "ADMIN";
      discord: string;
      locale: "FR" | "EN";
    };
  }
}
declare module "next-auth/jwt" {
  interface JWT {
    sessionVersion?: number;
    sessionId?: string;
    revoked?: boolean;
  }
}
