import type { EmailKind } from "../../generated/prisma/client.ts";
export type TemplateInput = {
  kind: EmailKind;
  locale: "FR" | "EN";
  name: string;
  url: string;
  reference?: string;
  totalCents?: bigint;
  items?: {
    name: string;
    quantity: number;
    unitPriceCents: number;
    keys?: string[];
  }[];
};
export const escapeHtml = (value: string) =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
export function emailTemplate(input: TemplateInput) {
  const fr = input.locale === "FR",
    esc = escapeHtml;
  const copy = fr
    ? {
        WELCOME: [
          "Bienvenue chez UNLOCK-ALL",
          "Votre prochain chapitre commence ici.",
          "Votre compte est prêt. Retrouvez votre profil et vos commandes dans votre espace personnel.",
          "Ouvrir mon compte",
        ],
        ORDER_CONFIRMATION: [
          "Commande de démonstration confirmée",
          "Votre commande est enregistrée.",
          "Aucun paiement n’a été effectué. Vos clés fictives restent accessibles dans Mes commandes ; leur livraison fait l’objet d’un email séparé.",
          "Voir ma commande",
        ],
        KEY_DELIVERY: [
          "Vos clés de démonstration UNLOCK-ALL",
          "Votre sélection est prête.",
          "Voici les clés fictives attribuées à votre commande. Les téléchargements sont disponibles dans le détail de commande après connexion.",
          "Retrouver mes clés",
        ],
        PASSWORD_RESET: [
          "Réinitialiser votre mot de passe UNLOCK-ALL",
          "Reprenez la main sur votre compte.",
          "Ce lien personnel expire après 20 minutes et ne peut être utilisé qu’une fois. Si vous n’avez pas demandé ce changement, ignorez cet email.",
          "Choisir un mot de passe",
        ],
      }
    : {
        WELCOME: [
          "Welcome to UNLOCK-ALL",
          "Your next chapter starts here.",
          "Your account is ready. Find your profile and orders in your personal account.",
          "Open my account",
        ],
        ORDER_CONFIRMATION: [
          "Demo order confirmed",
          "Your order has been saved.",
          "No payment was taken. Your fictional keys remain available in My orders; key delivery is sent as a separate email.",
          "View my order",
        ],
        KEY_DELIVERY: [
          "Your UNLOCK-ALL demo keys",
          "Your selection is ready.",
          "Here are the fictional keys assigned to your order. Downloads are available in the order details after signing in.",
          "Find my keys",
        ],
        PASSWORD_RESET: [
          "Reset your UNLOCK-ALL password",
          "Take control of your account.",
          "This personal link expires after 20 minutes and can only be used once. If you did not request this change, ignore this email.",
          "Choose a password",
        ],
      };
  const [subject, title, description, cta] = copy[input.kind];
  const money = (cents: bigint | number) =>
    new Intl.NumberFormat(fr ? "fr-FR" : "en-GB", {
      style: "currency",
      currency: "EUR",
    }).format(Number(cents) / 100);
  const lines = input.items ?? [];
  const lineHtml = lines
    .map(
      (item) =>
        `<tr><td style="padding:18px 0;border-bottom:1px solid #34313d"><strong style="color:#f3effa;font-size:16px">${esc(item.name)}</strong><p style="color:#b7aec9;font-size:13px">${fr ? "Quantité" : "Quantity"} : ${item.quantity} · ${esc(money(item.unitPriceCents))}</p>${(item.keys ?? []).map((k) => `<p style="font-family:monospace;color:#d8c4ff;background:#0d1016;border:1px solid #34313d;padding:12px;overflow-wrap:anywhere;word-break:break-all">${esc(k)}</p>`).join("")}</td></tr>`,
    )
    .join("");
  const greeting = fr ? "Bonjour" : "Hello",
    demo = fr ? "DÉMONSTRATION · AUCUN PAIEMENT" : "DEMONSTRATION · NO PAYMENT";
  const footer = fr
    ? "Produits et clés fictifs. Aucun effet sur les jeux. Gardez vos liens et vos clés personnels."
    : "Fictional products and keys. No effect on games. Keep your links and keys private.";
  const ref = input.reference
    ? `<p style="color:#b7aec9;font-size:12px;word-break:break-all">${fr ? "Référence" : "Reference"} : ${esc(input.reference)}</p>`
    : "";
  const total =
    input.totalCents !== undefined
      ? `<p style="color:#f3effa;font-size:18px">${fr ? "Total simulé" : "Simulated total"} : ${esc(money(input.totalCents))}</p>`
      : "";
  const html = `<!doctype html><html lang="${fr ? "fr" : "en"}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${esc(subject)}</title></head><body style="margin:0;padding:0;background:#090c11;font-family:Arial,Helvetica,sans-serif;color:#f3effa"><div style="display:none;max-height:0;overflow:hidden">${esc(description)}</div><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#090c11"><tr><td align="center" style="padding:32px 16px"><table role="presentation" width="600" cellspacing="0" cellpadding="0" style="width:100%;max-width:600px"><tr><td style="padding:0 8px 28px;color:#f3effa;font-weight:bold;font-size:23px">↗ UNLOCK-ALL</td></tr><tr><td style="background:#13161e;border:1px solid #34313d;border-radius:12px;padding:32px 24px"><p style="color:#c8aaff;font-size:10px;letter-spacing:2px">${demo}</p><h1 style="font-size:30px;line-height:1.2;margin:22px 0;color:#f3effa">${esc(title)}</h1><p style="font-size:15px;color:#b7aec9;line-height:1.7">${greeting} ${esc(input.name || (fr ? "joueur" : "player"))},</p><p style="font-size:15px;color:#b7aec9;line-height:1.7">${esc(description)}</p>${ref}<table role="presentation" width="100%" cellspacing="0" cellpadding="0">${lineHtml}</table>${total}<table role="presentation" cellspacing="0" cellpadding="0"><tr><td style="padding:24px 0 8px"><a href="${esc(input.url)}" style="display:inline-block;background:#8654df;border-radius:6px;color:#fff;text-decoration:none;font-size:14px;font-weight:bold;padding:15px 20px">${esc(cta)} →</a></td></tr></table><p style="font-size:11px;line-height:1.7;color:#b7aec9;word-break:break-all">${fr ? "Si le bouton ne fonctionne pas, copiez ce lien :" : "If the button does not work, copy this link:"}<br>${esc(input.url)}</p></td></tr><tr><td style="padding:24px 8px;font-size:11px;line-height:1.7;color:#9e94af">${esc(footer)}<br>UNLOCK-ALL · ${demo}</td></tr></table></td></tr></table></body></html>`;
  const text = [
    subject,
    `${greeting} ${input.name || (fr ? "joueur" : "player")},`,
    description,
    input.reference ?? "",
    ...lines.map(
      (i) =>
        `${i.name} × ${i.quantity} · ${money(i.unitPriceCents)}\n${(i.keys ?? []).join("\n")}`,
    ),
    input.totalCents !== undefined
      ? `${fr ? "Total simulé" : "Simulated total"} : ${money(input.totalCents)}`
      : "",
    `${cta}: ${input.url}`,
    footer,
    demo,
  ]
    .filter(Boolean)
    .join("\n\n");
  return { subject, html, text };
}
