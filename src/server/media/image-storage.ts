import { mkdir, readFile, stat, writeFile, unlink } from "node:fs/promises";
import { resolve, join } from "node:path";
import * as vercelBlob from "@vercel/blob";

type Env = Readonly<Record<string, string | undefined>>;
type Blob = Pick<typeof vercelBlob, "put" | "get" | "head" | "del">;
export const imageFilenamePattern =
  /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\.webp$/;
const maxBytes = 5 * 1024 * 1024;
export function createImageStorage(
  env: Env = process.env,
  blob: Blob = vercelBlob,
) {
  const cloud = env.PRODUCT_IMAGE_STORAGE === "vercel-blob";
  if (
    (!cloud &&
      env.PRODUCT_IMAGE_STORAGE &&
      env.PRODUCT_IMAGE_STORAGE !== "local") ||
    (env.VERCEL === "1" && !cloud) ||
    (cloud && !env.BLOB_READ_WRITE_TOKEN)
  )
    throw new Error("Image storage configuration unavailable.");
  const dir = resolve(env.PRODUCT_IMAGES_DIR || ".local/product-images");
  const options = () => ({
    token: env.BLOB_READ_WRITE_TOKEN,
    abortSignal: AbortSignal.timeout(15000),
  });
  function pathname(filename: string) {
    if (!imageFilenamePattern.test(filename))
      throw new Error("Invalid image filename.");
    return `product-images/${filename}`;
  }
  return {
    async write(filename: string, bytes: Buffer) {
      const path = pathname(filename);
      if (!bytes.length || bytes.length > maxBytes)
        throw new Error("Invalid image size.");
      if (cloud) {
        await blob.put(path, bytes, {
          ...options(),
          access: "private",
          contentType: "image/webp",
          addRandomSuffix: false,
          allowOverwrite: false,
        });
      } else {
        await mkdir(dir, { recursive: true, mode: 0o700 });
        await writeFile(join(dir, filename), bytes, {
          flag: "wx",
          mode: 0o600,
        });
      }
    },
    async exists(filename: string) {
      const path = pathname(filename);
      if (cloud) {
        try {
          const info = await blob.head(path, options());
          return (
            info.pathname === path &&
            info.contentType === "image/webp" &&
            info.size > 0 &&
            info.size <= maxBytes
          );
        } catch (error) {
          if (error instanceof vercelBlob.BlobNotFoundError) return false;
          throw error;
        }
      }
      try {
        return (await stat(join(dir, filename))).isFile();
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
        throw error;
      }
    },
    async read(filename: string) {
      const path = pathname(filename);
      if (cloud) {
        const result = await blob.get(path, {
          ...options(),
          access: "private",
          useCache: false,
        });
        if (!result) return null;
        if (
          result.statusCode !== 200 ||
          !result.stream ||
          result.blob.contentType !== "image/webp" ||
          !result.blob.size ||
          result.blob.size > maxBytes
        ) {
          await result.stream?.cancel();
          throw new Error("Invalid stored image.");
        }
        const reader = result.stream.getReader();
        const chunks: Uint8Array[] = [];
        let size = 0;
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            size += value.byteLength;
            if (size > maxBytes) {
              await reader.cancel();
              throw new Error("Invalid stored image size.");
            }
            chunks.push(value);
          }
        } finally {
          reader.releaseLock();
        }
        return Buffer.concat(chunks);
      }
      try {
        return await readFile(join(dir, filename));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
        throw error;
      }
    },
    async delete(filename: string) {
      const path = pathname(filename);
      if (cloud) await blob.del(path, options());
      else
        await unlink(join(dir, filename)).catch((error) => {
          if (error.code !== "ENOENT") throw error;
        });
    },
  };
}
