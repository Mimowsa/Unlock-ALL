import { administrator, catalogError } from "@/server/administration/http";
import { assertSameOrigin, privateJson } from "@/server/auth/http";
import { consumeRateLimit } from "@/server/auth/rate-limit";
import { getDatabase } from "@/server/db/client";
import {
  readImageBody,
  storeProductImage,
  deleteProductImage,
  ImageFailure,
} from "@/server/media/product-images";
export const runtime = "nodejs";
export async function POST(request: Request) {
  let url: string | undefined;
  try {
    const actor = await administrator();
    assertSameOrigin(request);
    const db = getDatabase();
    await consumeRateLimit(db, "product-image", actor.id, 30, 900);
    const input = await readImageBody(request);
    url = await storeProductImage(input);
    await db.auditLog.create({
      data: {
        actorId: actor.id,
        action: "product.image.upload",
        entityType: "ProductImage",
        entityId: url.split("/").at(-1)!,
      },
    });
    return privateJson({ url }, 201);
  } catch (error) {
    if (url) await deleteProductImage(url);
    return error instanceof ImageFailure
      ? privateJson({ error: "imageInvalid" }, error.status)
      : catalogError(error);
  }
}
