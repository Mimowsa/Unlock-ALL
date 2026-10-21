import type { DemoState, Product } from "./types.ts";
const stamp = "2026-10-20T12:00:00.000Z";
const packs = [
  {
    key: "unlock",
    fr: "Unlock All",
    en: "Unlock All",
    price: 2490,
    art: "operator",
    frDesc:
      "Le point de départ de votre expérience UNLOCK-ALL. Découvrez le parcours complet avec ce pack de présentation.",
    enDesc:
      "Your starting point for the UNLOCK-ALL experience. Discover the complete journey with this presentation pack.",
  },
  {
    key: "camos",
    fr: "Tous les camouflages",
    en: "All Camos",
    price: 1490,
    art: "camo",
    frDesc:
      "Une collection visuelle qui sort du lot. Explorez notre démonstration dédiée aux camouflages.",
    enDesc:
      "A visual collection that stands out. Explore our camouflage-themed demonstration.",
  },
  {
    key: "weapons",
    fr: "Toutes les armes",
    en: "All Weapons",
    price: 1990,
    art: "weapon",
    frDesc:
      "Un arsenal d’inspiration pour votre prochaine session. Un pack fictif pour tester la boutique.",
    enDesc:
      "An arsenal of inspiration for your next session. A fictional pack to explore the store.",
  },
  {
    key: "fullPack",
    fr: "Pack complet",
    en: "Complete Pack",
    price: 4490,
    art: "complete",
    frDesc:
      "Toute la collection réunie dans une seule expérience. Le pack signature de notre démonstration.",
    enDesc:
      "The whole collection in one experience. The signature pack of our demonstration.",
  },
] as const;
export function initialState(): DemoState {
  const products: Product[] = packs.flatMap((pack) =>
    (["PC", "PlayStation", "Xbox"] as const).map((platform, index) => ({
      id: `${pack.key}-${index}`,
      slug: `${pack.key.toLowerCase()}-${platform.toLowerCase()}`,
      name: { fr: pack.fr, en: pack.en },
      description: { fr: pack.frDesc, en: pack.enDesc },
      price: pack.price,
      platform,
      category: pack.key,
      art: pack.art,
      published: true,
      download: "/downloads/demo/unlock-all-demo.txt",
      createdAt: stamp,
      updatedAt: stamp,
    })),
  );
  return {
    version: 1,
    products,
    keys: products.flatMap((p, index) =>
      Array.from({ length: index === 8 ? 0 : 8 + index }, (_, i) => ({
        id: `${p.id}-key-${i}`,
        productId: p.id,
        value: `DEMO-${p.id.toUpperCase()}-${String(i + 1).padStart(4, "0")}`,
        disabled: false,
        orderId: null,
      })),
    ),
    users: [
      {
        id: "demo-customer",
        email: "joueur@example.com",
        nickname: "Player One",
        discord: "",
        role: "USER",
        active: true,
      },
      {
        id: "demo-admin",
        email: "admin@example.com",
        nickname: "Admin Demo",
        discord: "admin.demo",
        role: "ADMIN",
        active: true,
      },
    ],
    currentUserId: null,
    carts: { guest: [] },
    orders: [],
  };
}
