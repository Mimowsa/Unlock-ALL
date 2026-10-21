import type { ReactNode } from "react";
import "@/styles/globals.css";
export const metadata = {
  title: { default: "UNLOCK-ALL — Gaming Demo", template: "%s · UNLOCK-ALL" },
  description:
    "UNLOCK-ALL — Boutique gaming de démonstration. Produits et clés fictifs, aucun paiement.",
  robots: { index: false, follow: false },
};
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="fr" data-scroll-behavior="smooth">
      <body>{children}</body>
    </html>
  );
}
