import { z } from "zod";
export const keyInput = z
  .object({
    productId: z.string().min(1).max(100),
    value: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^DEMO-[A-Z0-9-]{3,80}$/),
  })
  .strict();
export const keyUpdate = z.object({ disabled: z.boolean() }).strict();
const item = {
  productId: z.string().min(1).max(100),
  quantity: z.number().int().min(0).max(1000),
};
export const cartMutation = z.discriminatedUnion("operation", [
  z
    .object({
      ...item,
      operation: z.literal("add"),
      quantity: z.number().int().min(1).max(1000),
    })
    .strict(),
  z
    .object({
      ...item,
      operation: z.literal("set"),
      revision: z.number().int().min(0),
    })
    .strict(),
]);
