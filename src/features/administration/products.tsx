"use client";
import Image from "next/image";
import { ProductImagePicker } from "./product-image-picker";
import { useState, type FormEvent } from "react";
import { Plus, Pencil, X } from "lucide-react";
import { useCopy } from "@/i18n/client";
import { useDemo } from "@/demo/provider";
import { adminError, adminWrite, useAdminData } from "./use-admin-data";
import { AdminDataState } from "./data-state";
import type { CopyKey } from "@/i18n/messages";
import type { Product } from "@/demo/types";
import { Button } from "@/components/ui/button";
export function ProductsAdmin() {
  const { t, locale, money } = useCopy();
  const { stock, refreshCatalog, setNotice } = useDemo();
  const resource = useAdminData<{ products: Product[] }>("/api/admin/products");
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [selectedImage, setSelectedImage] = useState<string | undefined>();
  const [selectedArt, setSelectedArt] = useState<Product["art"]>("operator");
  const [error, setError] = useState<CopyKey | null>(null);
  const products = resource.data?.products ?? [];
  const [editing, setEditing] = useState<Product | "new" | null>(null);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy || uploading) return;
    const f = new FormData(e.currentTarget);
    const old = editing !== "new" ? editing : null;
    const price = Number(f.get("price"));
    const download = String(f.get("download"));
    const slug = String(f.get("slug"));
    setBusy(true);
    setError(null);
    try {
      await adminWrite(
        old ? `/api/admin/products/${old.id}` : "/api/admin/products",
        old ? "PATCH" : "POST",
        {
          slug,
          name: {
            fr: String(f.get("nameFr")).trim(),
            en: String(f.get("nameEn")).trim(),
          },
          description: {
            fr: String(f.get("descFr")).trim(),
            en: String(f.get("descEn")).trim(),
          },
          price,
          platform: f.get("platform"),
          category: f.get("category"),
          art: selectedArt,
          ...(selectedImage ? { image: selectedImage } : {}),
          published: f.has("published"),
          download,
          ...(old ? { updatedAt: old.updatedAt } : {}),
        },
      );
      resource.reload();
      await refreshCatalog();
      setNotice("catalogSaved");
      setEditing(null);
    } catch (error) {
      setError(adminError(error instanceof Error ? error.message : undefined));
    } finally {
      setBusy(false);
    }
  }
  async function toggle(product: Product) {
    setBusy(true);
    setError(null);
    const { id, createdAt, availableStock, ...input } = product;
    try {
      await adminWrite(`/api/admin/products/${id}`, "PATCH", {
        ...input,
        published: !product.published,
      });
      resource.reload();
      await refreshCatalog();
      setNotice("catalogSaved");
    } catch (error) {
      setError(adminError(error instanceof Error ? error.message : undefined));
      resource.reload();
    } finally {
      setBusy(false);
    }
  }
  const old = editing && editing !== "new" ? editing : null;
  if (!resource.data)
    return <AdminDataState error={resource.error} retry={resource.reload} />;
  return (
    <>
      {error && (
        <p className="form-error" role="alert">
          {t(error)}
        </p>
      )}
      {resource.error && (
        <AdminDataState error={resource.error} retry={resource.reload} />
      )}
      <div className="admin-toolbar">
        <span>
          {products.length} {t("products")}
        </span>
        <Button
          size="sm"
          disabled={busy || uploading}
          onClick={() => {
            setError(null);
            setSelectedImage(undefined);
            setSelectedArt("operator");
            setEditing("new");
          }}
        >
          <Plus size={15} />
          {t("newProduct")}
        </Button>
      </div>
      {editing && (
        <section className="panel admin-editor">
          <div className="delivery-heading">
            <h2>{t(old ? "edit" : "newProduct")}</h2>
            <Button
              variant="ghost"
              size="icon"
              aria-label={t("close")}
              disabled={busy || uploading}
              onClick={() => setEditing(null)}
            >
              <X size={18} />
            </Button>
          </div>
          <form key={old?.id ?? "new"} onSubmit={submit} className="form-stack">
            <ProductImagePicker
              key={old?.id ?? "new"}
              art={selectedArt}
              image={selectedImage}
              busy={busy}
              uploading={uploading}
              onUploading={setUploading}
              onImage={setSelectedImage}
              onArt={(art) => {
                setSelectedArt(art);
                setSelectedImage(undefined);
              }}
            />
            <div className="form-grid">
              <label>
                {t("nameFr")}
                <input
                  name="nameFr"
                  required
                  maxLength={150}
                  defaultValue={old?.name.fr}
                />
              </label>
              <label>
                {t("nameEn")}
                <input
                  name="nameEn"
                  required
                  maxLength={150}
                  defaultValue={old?.name.en}
                />
              </label>
              <label>
                Slug
                <input
                  name="slug"
                  required
                  pattern="[a-z0-9]+(-[a-z0-9]+)*"
                  maxLength={100}
                  defaultValue={old?.slug}
                />
              </label>
              <label>
                {t("priceCents")}
                <input
                  name="price"
                  required
                  type="number"
                  min="0"
                  max="100000000"
                  step="1"
                  defaultValue={old?.price ?? 2490}
                />
              </label>
              <label>
                {t("platform")}
                <select name="platform" defaultValue={old?.platform ?? "PC"}>
                  {["PC", "PlayStation", "Xbox"].map((p) => (
                    <option key={p}>{p}</option>
                  ))}
                </select>
              </label>
              <label>
                {t("category")}
                <select
                  name="category"
                  defaultValue={old?.category ?? "unlock"}
                >
                  {(["unlock", "camos", "weapons", "fullPack"] as const).map(
                    (c) => (
                      <option value={c} key={c}>
                        {t(c)}
                      </option>
                    ),
                  )}
                </select>
              </label>
              <label>
                {t("downloadLink")}
                <input
                  name="download"
                  required
                  defaultValue={
                    old?.download ?? "/downloads/demo/unlock-all-demo.txt"
                  }
                />
              </label>
            </div>
            <p className="field-hint">{t("downloadHelp")}</p>
            <label>
              {t("descFr")}
              <textarea
                name="descFr"
                required
                maxLength={2000}
                defaultValue={old?.description.fr}
              />
            </label>
            <label>
              {t("descEn")}
              <textarea
                name="descEn"
                required
                maxLength={2000}
                defaultValue={old?.description.en}
              />
            </label>
            <label className="checkbox-label">
              <input
                name="published"
                type="checkbox"
                defaultChecked={old?.published ?? true}
              />
              {t("published")}
            </label>
            <div className="button-row">
              <Button type="submit" disabled={busy || uploading}>
                {t(busy ? "authWorking" : "save")}
              </Button>
              <Button
                type="button"
                variant="outline"
                disabled={busy || uploading}
                onClick={() => setEditing(null)}
              >
                {t("cancel")}
              </Button>
            </div>
          </form>
        </section>
      )}
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              {(
                [
                  "product",
                  "platform",
                  "fictionalPrice",
                  "status",
                  "stock",
                ] as const
              ).map((k) => (
                <th key={k}>{t(k)}</th>
              ))}
              <th>
                <span className="sr-only">{t("edit")}</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {products.map((p) => (
              <tr key={p.id}>
                <td>
                  <div className="admin-product-identity">
                    <Image
                      src={p.image ?? `/images/${p.art}.svg`}
                      width={64}
                      height={48}
                      unoptimized={!!p.image}
                      alt={`${t("imageAlt")} ${p.name[locale]}`}
                    />
                    <strong>{p.name[locale]}</strong>
                  </div>
                </td>
                <td>{p.platform}</td>
                <td>{money(p.price)}</td>
                <td>
                  <button
                    className={`badge ${p.published ? "completed" : ""}`}
                    disabled={busy || uploading}
                    onClick={() => void toggle(p)}
                  >
                    {t(p.published ? "published" : "disabled")}
                  </button>
                </td>
                <td>{stock(p.id)}</td>
                <td>
                  <button
                    className="button button-ghost button-icon"
                    aria-label={`${t("edit")} ${p.name[locale]} ${p.platform}`}
                    disabled={busy || uploading}
                    onClick={() => {
                      setError(null);
                      setSelectedImage(p.image);
                      setSelectedArt(p.art);
                      setEditing(p);
                    }}
                  >
                    <Pencil size={15} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
