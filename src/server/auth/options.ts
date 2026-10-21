import "server-only";
import type { NextAuthOptions, Session } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import { getDatabase } from "../db/client";
import {
  authenticate,
  createLoginSession,
  sessionUser,
  revokeSession,
  SESSION_SECONDS,
} from "./service";
import { clientIdentifier } from "./http";

export const authOptions: NextAuthOptions = {
  secret: process.env.NEXTAUTH_SECRET,
  providers: [
    CredentialsProvider({
      name: "Email",
      credentials: { email: { type: "email" }, password: { type: "password" } },
      async authorize(credentials, request) {
        try {
          return await authenticate(
            getDatabase(),
            credentials,
            clientIdentifier(request.headers),
          );
        } catch {
          return null;
        }
      },
    }),
  ],
  session: { strategy: "jwt", maxAge: SESSION_SECONDS },
  jwt: { maxAge: SESSION_SECONDS },
  pages: { signIn: "/fr/connexion", error: "/fr/connexion" },
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.sub = user.id;
        token.sessionVersion = user.sessionVersion;
        token.sessionId = await createLoginSession(getDatabase(), user);
      }
      const current = await sessionUser(getDatabase(), token);
      token.revoked = !current;
      // Client-supplied session updates never determine identity or privileges.
      return token;
    },
    async session({ session, token }) {
      const current = !token.revoked
        ? await sessionUser(getDatabase(), token)
        : null;
      // An empty payload is v4's unauthenticated response. Its browser client
      // expects an object, while getServerSession converts this to null.
      if (!current) return {} as Session;
      session.user = current;
      return session;
    },
    async redirect({ url, baseUrl }) {
      const target = new URL(url, baseUrl);
      return target.origin === new URL(baseUrl).origin ? target.href : baseUrl;
    },
  },
  events: {
    async signOut({ token }) {
      if (typeof token?.sessionId === "string")
        await revokeSession(getDatabase(), token.sessionId);
    },
  },
  logger: {
    error(code) {
      console.error(
        `Authentication request failed: ${/^[A-Z0-9_]+$/.test(code) ? code : "UNKNOWN"}`,
      );
    },
    warn(code) {
      console.warn(`Authentication configuration: ${code}`);
    },
    debug() {},
  },
};
