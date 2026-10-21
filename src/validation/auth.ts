import { z } from "zod";
export const emailSchema = z.string().trim().toLowerCase().email().max(254);
export const passwordSchema = z.string().min(15).max(128);
export const discordSchema = z
  .string()
  .trim()
  .max(32)
  .refine((v) => !v || /^[a-z0-9_](?!.*\.\.)[a-z0-9_.]{1,31}$/.test(v));
export const registrationSchema = z
  .object({
    email: emailSchema,
    password: passwordSchema,
    nickname: z.string().trim().min(2).max(40),
    locale: z.enum(["FR", "EN"]).default("FR"),
  })
  .strict();
export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1).max(128),
});
export const resetRequestSchema = z
  .object({ email: emailSchema, locale: z.enum(["FR", "EN"]).default("FR") })
  .strict();
export const resetPasswordSchema = z
  .object({
    token: z.string().regex(/^[a-f0-9]{64}$/),
    password: passwordSchema,
  })
  .strict();
export const profileSchema = z
  .object({
    nickname: z.string().trim().min(2).max(40),
    discord: discordSchema,
  })
  .strict();
