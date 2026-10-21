import { notFound } from "next/navigation";
import { getDatabase } from "@/server/db/client";
import { publishedProduct } from "@/server/catalog/service";
import { ProductPage } from "@/features/catalog/product";
import { DemoPage } from "@/components/demo-page";
import { pageMetadata } from "@/i18n/metadata";
export const generateMetadata = pageMetadata("product");
export default async function Page({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  if (!(await publishedProduct(getDatabase(), slug))) notFound();
  return (
    <DemoPage>
      <ProductPage key={slug} slug={slug} />
    </DemoPage>
  );
}
