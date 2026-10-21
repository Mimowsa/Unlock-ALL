ALTER TABLE "EmailJob"
 ADD COLUMN "recipient" varchar(254),
 ADD COLUMN "firstAttemptAt" timestamptz(3),
 ADD COLUMN "lockToken" text,
 ADD COLUMN "payloadCiphertext" text,
 ADD COLUMN "payloadKeyId" text,
 ADD COLUMN "resetTokenId" text;
UPDATE "EmailJob" j SET "recipient"=CASE WHEN j."orderId" IS NULL THEN u."email" ELSE (SELECT o."customerEmail" FROM "Order" o WHERE o."id"=j."orderId") END FROM "User" u WHERE j."userId"=u."id";
ALTER TABLE "EmailJob" ALTER COLUMN "recipient" SET NOT NULL;
ALTER TABLE "EmailJob"
 ADD CONSTRAINT "EmailJob_resetTokenId_fkey" FOREIGN KEY ("resetTokenId") REFERENCES "PasswordResetToken"("id") ON DELETE SET NULL ON UPDATE CASCADE,
 ADD CONSTRAINT "EmailJob_recipient_normalized" CHECK ("recipient"=lower(btrim("recipient")) AND "recipient" ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'),
 ADD CONSTRAINT "EmailJob_payload_pair" CHECK (("payloadCiphertext" IS NULL)=("payloadKeyId" IS NULL));
CREATE TABLE "EmailWorkerLease" ("id" text PRIMARY KEY, "token" text, "lockedUntil" timestamptz(3));
