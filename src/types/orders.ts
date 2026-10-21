export type OrderSummary = {
  id: string;
  reference: string;
  date: string;
  total: number;
  status: "completed" | "failed";
  customer?: string;
};
export type OrderView = OrderSummary & {
  paypal: {
    status: string;
    captureId?: string | null;
    account?: string;
  } | null;
  email: {
    status: "not_sent" | "restricted" | "queued" | "accepted" | "failed";
    jobs?: {
      kind: string;
      status: string;
      attempts: number;
      lastErrorCode: string | null;
    }[];
  };
  items: {
    id: string;
    name: { fr: string; en: string };
    platform: string;
    unitPrice: number;
    quantity: number;
    keys: string[];
    download: string | null;
  }[];
  events: { type: string; date: string }[];
};
