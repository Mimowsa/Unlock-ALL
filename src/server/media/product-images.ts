import { createImageStorage, imageFilenamePattern } from "./image-storage.ts";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
export const MAX_PRODUCT_IMAGE_BYTES = 4 * 1024 * 1024;
export const productImagePath = /^\/api\/media\/products\/[a-f0-9-]{36}\.webp$/;
const filenamePattern = imageFilenamePattern;
export class ImageFailure extends Error {
  status: number;
  constructor(status = 400) {
    super("imageInvalid");
    this.status = status;
  }
}
export async function readImageBody(request: Request) {
  if (
    !["image/jpeg", "image/png", "image/webp"].includes(
      request.headers.get("content-type")?.toLowerCase() ?? "",
    )
  )
    throw new ImageFailure(415);
  if (Number(request.headers.get("content-length")) > MAX_PRODUCT_IMAGE_BYTES)
    throw new ImageFailure(413);
  const reader = request.body?.getReader();
  if (!reader) throw new ImageFailure();
  const parts: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_PRODUCT_IMAGE_BYTES) {
        await reader.cancel();
        throw new ImageFailure(413);
      }
      parts.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  if (!size) throw new ImageFailure();
  return Buffer.concat(parts);
}
export async function storeProductImage(input: Buffer) {
  if (!input.length || input.length > MAX_PRODUCT_IMAGE_BYTES)
    throw new ImageFailure(413);
  let bytes: Buffer;
  try {
    const image = sharp(input, {
      limitInputPixels: 25000000,
      failOn: "warning",
    });
    const info = await image.metadata();
    if (
      !["jpeg", "png", "webp"].includes(info.format ?? "") ||
      (info.pages ?? 1) > 1
    )
      throw new ImageFailure();
    // Decode and re-encode: no original file, executable payload or EXIF metadata is served.
    bytes = await image
      .rotate()
      .resize({
        width: 1600,
        height: 1600,
        fit: "inside",
        withoutEnlargement: true,
      })
      .webp({ quality: 85 })
      .toBuffer();
  } catch {
    throw new ImageFailure();
  }
  const filename = `${randomUUID()}.webp`;
  await createImageStorage().write(filename, bytes);
  return `/api/media/products/${filename}`;
}
export async function assertProductImage(url: string) {
  if (!productImagePath.test(url)) throw new ImageFailure();
  const filename = url.split("/").at(-1)!;
  if (!filenamePattern.test(filename)) throw new ImageFailure();
  try {
    if (!(await createImageStorage().exists(filename)))
      throw new ImageFailure();
  } catch {
    throw new ImageFailure();
  }
}
export async function deleteProductImage(url: string) {
  if (productImagePath.test(url))
    await createImageStorage()
      .delete(url.split("/").at(-1)!)
      .catch(() => {});
}
export async function readProductImage(filename: string) {
  if (!filenamePattern.test(filename)) return null;
  return createImageStorage().read(filename);
}
