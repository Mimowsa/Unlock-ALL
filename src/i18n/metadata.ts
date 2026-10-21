import type { Metadata } from "next";
import { messages, type CopyKey } from "./messages";
export function pageMetadata(key: CopyKey) {
  return async ({
    params,
  }: {
    params: Promise<{ locale: string }>;
  }): Promise<Metadata> => {
    const { locale } = await params;
    return {
      title: `${messages[locale === "en" ? "en" : "fr"][key]} · UNLOCK-ALL`,
    };
  };
}
