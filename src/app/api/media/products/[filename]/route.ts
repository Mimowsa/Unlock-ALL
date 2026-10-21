import { readProductImage } from "@/server/media/product-images";
export const runtime = "nodejs";
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ filename: string }> },
) {
  const { filename } = await params;
  let bytes: Buffer | null;
  try { bytes = await readProductImage(filename); }
  catch { return new Response(null, { status: 503, headers: { "Cache-Control": "no-store" } }); }
  if (!bytes) return new Response(null, { status: 404 });
  return new Response(new Uint8Array(bytes), {
    headers: {
      "Content-Type": "image/webp",
      "Cache-Control": "public, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
