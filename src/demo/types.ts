export type Localized = { fr: string; en: string };
export type Product = {
  id: string;
  slug: string;
  name: Localized;
  description: Localized;
  price: number;
  platform: "PC" | "PlayStation" | "Xbox";
  category: "unlock" | "camos" | "weapons" | "fullPack";
  art: "operator" | "camo" | "weapon" | "complete";
  image?: string;
  availableStock?: number;
  published: boolean;
  download: string;
  createdAt: string;
  updatedAt: string;
};
export type DemoUser = {
  id: string;
  email: string;
  nickname: string;
  discord: string;
  role: "USER" | "ADMIN";
  active: boolean;
};
export type DemoKey = {
  id: string;
  productId: string;
  value: string;
  disabled: boolean;
  orderId: string | null;
};
export type CartItem = { productId: string; quantity: number };
export type OrderItem = {
  productId: string;
  name: Localized;
  platform: string;
  unitPrice: number;
  quantity: number;
  keys: string[];
  download: string;
};
export type DemoOrder = {
  id: string;
  reference: string;
  userId: string;
  customer: string;
  date: string;
  total: number;
  status: "completed" | "failed";
  items: OrderItem[];
  discord: string;
  idempotency: string;
  error?: "stockError";
  events: string[];
};
export type DemoState = {
  version: 1;
  products: Product[];
  keys: DemoKey[];
  users: DemoUser[];
  currentUserId: string | null;
  carts: Record<string, CartItem[]>;
  orders: DemoOrder[];
};
export type DemoError =
  | "stockError"
  | "emptyError"
  | "signInRequired"
  | "discordRequired";
