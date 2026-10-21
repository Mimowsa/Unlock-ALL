import { z } from "zod";
const localized = (max: number) =>
  z
    .object({
      fr: z.string().trim().min(1).max(max),
      en: z.string().trim().min(1).max(max),
    })
    .strict();
export const productInput = z
  .object({
    slug: z
      .string()
      .min(1)
      .max(100)
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
    name: localized(150),
    description: localized(2000),
    price: z.number().int().min(0).max(100000000),
    platform: z.enum(["PC", "PlayStation", "Xbox"]),
    category: z.enum(["unlock", "camos", "weapons", "fullPack"]),
    art: z.enum(["operator", "camo", "weapon", "complete"]),
    image: z
      .string()
      .regex(/^\/api\/media\/products\/[a-f0-9-]{36}\.webp$/)
      .optional(),
    published: z.boolean(),
    download: z.literal("/downloads/demo/unlock-all-demo.txt"),
  })
  .strict();
export const productUpdate = productInput.extend({
  updatedAt: z.iso.datetime(),
});
export const userUpdate = z
  .object({
    role: z.enum(["USER", "ADMIN"]),
    active: z.boolean(),
    updatedAt: z.iso.datetime(),
  })
  .strict();
export type ProductInput = z.infer<typeof productInput>;
