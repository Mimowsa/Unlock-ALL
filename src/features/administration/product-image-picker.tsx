"use client";
import Image from "next/image";
import { useState, type ChangeEvent } from "react";
import { useCopy } from "@/i18n/client";
import type { Product } from "@/demo/types";
export function ProductImagePicker({
  art,
  image,
  busy,
  uploading,
  onArt,
  onImage,
  onUploading,
}: {
  art: Product["art"];
  image?: string;
  busy: boolean;
  uploading: boolean;
  onArt: (art: Product["art"]) => void;
  onImage: (url: string) => void;
  onUploading: (value: boolean) => void;
}) {
  const { t } = useCopy();
  const [error, setError] = useState(false);
  async function upload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setError(false);
    if (
      !["image/jpeg", "image/png", "image/webp"].includes(file.type) ||
      file.size > 4 * 1024 * 1024
    ) {
      setError(true);
      return;
    }
    onUploading(true);
    try {
      const response = await fetch("/api/admin/product-images", {
        method: "POST",
        headers: { "Content-Type": file.type },
        body: file,
      });
      const result = await response.json();
      if (!response.ok) throw new Error("upload");
      onImage(result.url);
    } catch {
      setError(true);
    } finally {
      onUploading(false);
    }
  }
  return (
    <section className="product-image-picker" aria-label={t("productImage")}>
      <div className="product-image-preview">
        <Image
          src={image ?? `/images/${art}.svg`}
          alt={t("imagePreview")}
          fill
          sizes="(max-width: 640px) 100vw, 240px"
          unoptimized={!!image}
        />
      </div>
      <div className="form-stack">
        <label>
          {t("uploadImage")}
          <input
            type="file"
            accept="image/png,image/jpeg,image/webp"
            disabled={busy || uploading}
            onChange={(event) => void upload(event)}
          />
        </label>
        <p className="field-hint">{t("imageUploadHelp")}</p>
        <label>
          {t("art")}
          <select
            name="art"
            value={art}
            disabled={busy || uploading}
            onChange={(event) => {
              setError(false);
              onArt(event.target.value as Product["art"]);
            }}
          >
            {(["operator", "camo", "weapon", "complete"] as const).map(
              (a, i) => (
                <option value={a} key={a}>
                  {t((["unlock", "camos", "weapons", "fullPack"] as const)[i])}
                </option>
              ),
            )}
          </select>
        </label>
        {image && (
          <button
            type="button"
            className="text-link"
            disabled={busy || uploading}
            onClick={() => onArt(art)}
          >
            {t("usePresetImage")}
          </button>
        )}
        {uploading && <p role="status">{t("imageUploading")}</p>}
        {error && (
          <p className="form-error" role="alert">
            {t("imageInvalid")}
          </p>
        )}
        <p className="field-hint">{t("imageSaveHint")}</p>
      </div>
    </section>
  );
}
