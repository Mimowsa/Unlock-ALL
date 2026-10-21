ALTER TABLE "Cart" ALTER COLUMN "userId" DROP NOT NULL;
ALTER TABLE "Cart" ADD COLUMN "guestTokenHash" CHAR(64);
ALTER TABLE "Cart" ADD COLUMN "expiresAt" TIMESTAMPTZ(3);
ALTER TABLE "Cart" ADD COLUMN "revision" INTEGER NOT NULL DEFAULT 0;
CREATE UNIQUE INDEX "Cart_guestTokenHash_key" ON "Cart"("guestTokenHash");
CREATE INDEX "Cart_expiresAt_idx" ON "Cart"("expiresAt");
ALTER TABLE "Cart" ADD CONSTRAINT "Cart_owner_valid" CHECK (
  ("userId" IS NOT NULL AND "guestTokenHash" IS NULL AND "expiresAt" IS NULL)
  OR ("userId" IS NULL AND "guestTokenHash" IS NOT NULL AND "guestTokenHash" ~ '^[a-f0-9]{64}$' AND "expiresAt" IS NOT NULL)
);
ALTER TABLE "Cart" ADD CONSTRAINT "Cart_revision_valid" CHECK ("revision" >= 0);
