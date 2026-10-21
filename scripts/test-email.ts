import nextEnv from "@next/env";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { emailConfig } from "../src/server/email/config.ts";
import { sendResend, DeliveryFailure } from "../src/server/email/resend.ts";
nextEnv.loadEnvConfig(process.cwd());
try {
  const config = emailConfig();
  if (!config) throw new Error("Email not configured");
  // One stable key per local setup, including retries after an uncertain response.
  await mkdir(".local", { recursive: true, mode: 0o700 });
  const file = ".local/resend-connection-test.json";
  let state: { key: string; createdAt: number; accepted?: boolean };
  try {
    state = JSON.parse(await readFile(file, "utf8"));
  } catch {
    state = { key: `connection-test/${randomUUID()}`, createdAt: Date.now() };
    await writeFile(file, JSON.stringify(state), { mode: 0o600, flag: "wx" });
  }
  if (state.accepted) {
    console.log(
      "The connection test was already accepted. No additional email sent.",
    );
  } else {
    if (Date.now() - state.createdAt > 23 * 60 * 60 * 1000)
      throw new Error("Review previous test before sending another.");
    await sendResend(
      {
        from: config.from,
        to: [config.testRecipient],
        subject: "UNLOCK-ALL — test de connexion Resend",
        text: "La connexion Resend fonctionne. Ceci est un test technique de votre maquette UNLOCK-ALL. Aucun compte ni commande n’a été créé. Aucun paiement. Les emails de démonstration sont limités à cette adresse.",
        html: '<!doctype html><html lang="fr"><body style="margin:0;background:#090c11;color:#f3effa;font-family:Arial,sans-serif;padding:32px 16px"><div style="max-width:560px;margin:auto"><p style="font-size:24px;font-weight:bold">↗ UNLOCK-ALL</p><div style="padding:32px 24px;background:#13161e;border:1px solid #34313d;border-radius:12px"><p style="font-size:11px;letter-spacing:2px;color:#c8aaff">DÉMONSTRATION</p><h1 style="font-size:30px">La connexion email est prête.</h1><p style="color:#b7aec9;line-height:1.7">Ceci est un test technique de votre maquette UNLOCK-ALL. Aucun compte ni commande n’a été créé. Aucun paiement n’a été effectué.</p><p style="color:#b7aec9;line-height:1.7">Les emails de démonstration sont limités à cette adresse.</p></div></div></body></html>',
      },
      state.key,
      config,
    );
    await writeFile(file, JSON.stringify({ ...state, accepted: true }), {
      mode: 0o600,
    });
    console.log(
      "Connection test accepted by Resend. Check the authorized inbox and spam folder. This does not confirm inbox delivery.",
    );
  }
} catch (error) {
  console.error(
    error instanceof DeliveryFailure
      ? `Email connection test unavailable (${error.code}). No secrets logged.`
      : "Email connection test unavailable. Check private configuration. No secrets logged.",
  );
  process.exitCode = 1;
}
