import { mkdir, writeFile } from "node:fs/promises";
import { emailTemplate } from "../src/server/email/templates.ts";
import type { EmailKind } from "../src/generated/prisma/client.ts";
const directory = ".local/email-previews";
await mkdir(directory, { recursive: true, mode: 0o700 });
for (const locale of ["FR", "EN"] as const)
  for (const kind of [
    "WELCOME",
    "ORDER_CONFIRMATION",
    "KEY_DELIVERY",
    "PASSWORD_RESET",
  ] as EmailKind[]) {
    const result = emailTemplate({
      locale,
      kind,
      name: "Player Demo",
      reference: "UA-DEMO-APERÇU",
      totalCents: 4980n,
      items:
        kind === "ORDER_CONFIRMATION" || kind === "KEY_DELIVERY"
          ? [
              {
                name: "Unlock All · PC",
                quantity: 2,
                unitPriceCents: 2490,
                ...(kind === "KEY_DELIVERY"
                  ? { keys: ["DEMO-EXEMPLE-0001", "DEMO-EXEMPLE-0002"] }
                  : {}),
              },
            ]
          : [],
      url:
        kind === "PASSWORD_RESET"
          ? "http://127.0.0.1:3000/fr/reinitialiser-mot-de-passe#EXEMPLE-NON-UTILISABLE"
          : `http://127.0.0.1:3000/${locale.toLowerCase()}/compte`,
    });
    await writeFile(
      `${directory}/${kind.toLowerCase()}-${locale.toLowerCase()}.html`,
      result.html,
      { mode: 0o600 },
    );
    await writeFile(
      `${directory}/${kind.toLowerCase()}-${locale.toLowerCase()}.txt`,
      result.text,
      { mode: 0o600 },
    );
  }
console.log(
  "Eight private HTML/text previews created in .local/email-previews. All preview keys and reset links are fictional.",
);
