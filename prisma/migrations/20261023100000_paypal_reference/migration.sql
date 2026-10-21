ALTER TABLE "PayPalMerchant" ADD COLUMN "transferRecipient" text, ADD COLUMN "reportingEnabled" boolean NOT NULL DEFAULT false;
ALTER TABLE "PayPalCheckout" ADD COLUMN "method" text NOT NULL DEFAULT 'CHECKOUT', ADD COLUMN "transferReference" text, ADD COLUMN "recipient" text, ADD COLUMN "payUntil" timestamptz(3), ADD COLUMN "lastCheckedAt" timestamptz(3);
CREATE UNIQUE INDEX "PayPalCheckout_transferReference_key" ON "PayPalCheckout"("transferReference");
ALTER TABLE "PayPalCheckout" ADD CONSTRAINT "PayPalCheckout_reference_shape" CHECK (("method"='CHECKOUT' AND "transferReference" IS NULL AND "recipient" IS NULL AND "payUntil" IS NULL) OR ("method"='REFERENCE' AND "transferReference" ~ '^UA-M-[A-F0-9]{24}$' AND "transferReference" IS NOT NULL AND "recipient" IS NOT NULL AND "payUntil" IS NOT NULL AND "payUntil">"createdAt" AND "expiresAt">"payUntil" AND "paypalOrderId" IS NULL AND "approvalUrl" IS NULL));
CREATE TABLE "PayPalTransferReceipt" (
 "checkoutId" text PRIMARY KEY REFERENCES "PayPalCheckout"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 "transactionId" text NOT NULL,"accountId" text NOT NULL,"reference" text NOT NULL,"amountCents" bigint NOT NULL,"currency" text NOT NULL,"eventCode" text NOT NULL,"status" text NOT NULL,"paidAt" timestamptz(3) NOT NULL,"verifiedAt" timestamptz(3) NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX "PayPalTransferReceipt_transactionId_key" ON "PayPalTransferReceipt"("transactionId");
CREATE FUNCTION guard_transfer_receipt() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'Transfer evidence is immutable' USING ERRCODE='23514'; END IF;
 IF NOT EXISTS (SELECT 1 FROM "PayPalCheckout" p JOIN "PayPalMerchant" m ON m."id"=p."merchantId" WHERE p."id"=NEW."checkoutId" AND p."method"='REFERENCE' AND p."transferReference"=NEW."reference" AND p."amountCents"=NEW."amountCents" AND p."currency"=NEW."currency" AND m."merchantId"=NEW."accountId" AND NEW."paidAt">=p."createdAt" AND NEW."paidAt"<=p."payUntil") OR NEW."status"<>'S' OR NEW."eventCode"<>'T0000' THEN RAISE EXCEPTION 'Transfer evidence does not match the expected payment' USING ERRCODE='23514'; END IF;
 RETURN NEW; END $$;
CREATE TRIGGER "PayPalTransferReceipt_guard" BEFORE INSERT OR UPDATE OR DELETE ON "PayPalTransferReceipt" FOR EACH ROW EXECUTE FUNCTION guard_transfer_receipt();
CREATE FUNCTION guard_transfer_checkout() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF TG_OP='UPDATE' AND (NEW."method",NEW."transferReference",NEW."recipient",NEW."payUntil") IS DISTINCT FROM (OLD."method",OLD."transferReference",OLD."recipient",OLD."payUntil") THEN RAISE EXCEPTION 'Transfer instructions are immutable' USING ERRCODE='23514'; END IF;
 IF NEW."method"='REFERENCE' AND NEW."status" IN ('VERIFIED','FULFILLED','REFUNDED','PARTIALLY_REFUNDED','REVERSED') AND NOT EXISTS(SELECT 1 FROM "PayPalTransferReceipt" r WHERE r."checkoutId"=NEW."id" AND r."transactionId"=NEW."captureId") THEN RAISE EXCEPTION 'Verified reporting evidence required before delivery' USING ERRCODE='23514'; END IF;
 RETURN NEW; END $$;
CREATE TRIGGER "PayPalCheckout_transfer_guard" BEFORE INSERT OR UPDATE ON "PayPalCheckout" FOR EACH ROW EXECUTE FUNCTION guard_transfer_checkout();
