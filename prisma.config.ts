import nextEnv from "@next/env";
import { defineConfig } from "prisma/config";
nextEnv.loadEnvConfig(process.cwd());
export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "node --experimental-strip-types prisma/seed.ts",
  },
  // No URL is needed to generate/validate the client. Migrations require DIRECT_URL.
  datasource: {
    url: process.env.DIRECT_URL,
    shadowDatabaseUrl: process.env.SHADOW_DATABASE_URL,
  },
});
