import { z } from "zod";
import { discordSchema } from "./auth.ts";
export const orderInput = z
  .object({
    idempotencyKey: z.uuid(),
    cartRevision: z.number().int().min(0),
    cartFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
    discord: discordSchema.refine((value) => value.length >= 2),
    locale: z.enum(["FR", "EN"]),
    consent: z.literal(true),
  })
  .strict();
export type OrderInput = z.infer<typeof orderInput>;
