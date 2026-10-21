-- PostgreSQL constraints/triggers which cannot be represented in the Prisma schema.
ALTER TABLE "User"
  ADD CONSTRAINT "User_email_normalized" CHECK ("email" = lower(btrim("email")) AND "email" ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'),
  ADD CONSTRAINT "User_password_hash_only" CHECK ("passwordHash" IS NULL OR "passwordHash" LIKE '$argon2id$%'),
  ADD CONSTRAINT "User_session_version_nonnegative" CHECK ("sessionVersion" >= 0),
  ADD CONSTRAINT "User_discord_format" CHECK ("discordUsername" IS NULL OR ("discordUsername" ~ '^[a-z0-9_][a-z0-9_.]{1,31}$' AND "discordUsername" NOT LIKE '%..%'));
ALTER TABLE "Product"
  ADD CONSTRAINT "Product_price_nonnegative" CHECK ("priceCents" >= 0),
  ADD CONSTRAINT "Product_currency_eur" CHECK ("currency" = 'EUR');
ALTER TABLE "ProductImage" ADD CONSTRAINT "ProductImage_position_nonnegative" CHECK ("position" >= 0);
ALTER TABLE "CartItem" ADD CONSTRAINT "CartItem_quantity_valid" CHECK ("quantity" BETWEEN 1 AND 1000);
ALTER TABLE "PasswordResetToken"
  ADD CONSTRAINT "PasswordResetToken_hash_format" CHECK ("tokenHash" ~ '^[0-9a-f]{64}$'),
  ADD CONSTRAINT "PasswordResetToken_expiry_valid" CHECK ("expiresAt" > "createdAt");
ALTER TABLE "ActivationKey"
  ADD CONSTRAINT "ActivationKey_fingerprint_format" CHECK ("fingerprint" ~ '^[0-9a-f]{64}$'),
  ADD CONSTRAINT "ActivationKey_ciphertext_envelope" CHECK ("ciphertext" ~ '^v1\.[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]+$'),
  ADD CONSTRAINT "ActivationKey_key_version" CHECK ("encryptionKeyId" ~ '^[A-Za-z0-9_-]{1,40}$');
ALTER TABLE "Order"
  ADD CONSTRAINT "Order_money_valid" CHECK ("subtotalCents" >= 0 AND "totalCents" >= 0 AND "currency" = 'EUR'),
  ADD CONSTRAINT "Order_request_hash_format" CHECK ("requestHash" ~ '^[0-9a-f]{64}$'),
  ADD CONSTRAINT "Order_idempotency_nonempty" CHECK (length(btrim("idempotencyKey")) BETWEEN 1 AND 200),
  ADD CONSTRAINT "Order_discord_format" CHECK ("discordUsername" ~ '^[a-z0-9_][a-z0-9_.]{1,31}$' AND "discordUsername" NOT LIKE '%..%'),
  ADD CONSTRAINT "Order_payment_mode" CHECK (("mode" = 'DEMO' AND "paymentStatus" = 'NOT_REQUIRED') OR ("mode" = 'COMMERCIAL' AND "paymentStatus" <> 'NOT_REQUIRED'));
ALTER TABLE "OrderItem"
  ADD CONSTRAINT "OrderItem_quantity_valid" CHECK ("quantity" BETWEEN 1 AND 1000),
  ADD CONSTRAINT "OrderItem_money_valid" CHECK ("unitPriceCents" >= 0 AND "lineTotalCents" = "unitPriceCents"::bigint * "quantity"::bigint);
ALTER TABLE "KeyAssignment" ADD CONSTRAINT "KeyAssignment_unit_positive" CHECK ("unitIndex" > 0);
ALTER TABLE "EmailJob"
  ADD CONSTRAINT "EmailJob_attempts_valid" CHECK ("attempts" >= 0 AND "maxAttempts" > 0 AND "attempts" <= "maxAttempts"),
  ADD CONSTRAINT "EmailJob_sent_timestamp" CHECK (("status" = 'SENT') = ("sentAt" IS NOT NULL)),
  ADD CONSTRAINT "EmailJob_order_kind" CHECK (("kind" IN ('ORDER_CONFIRMATION', 'KEY_DELIVERY')) = ("orderId" IS NOT NULL));
ALTER TABLE "SiteSetting" ADD CONSTRAINT "SiteSetting_singleton" CHECK ("id" = 'site');

CREATE FUNCTION guard_key_assignment() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  key_row "ActivationKey"%ROWTYPE;
  item_quantity integer;
  order_status "OrderStatus";
  order_mode "OrderMode";
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'Key assignments are immutable; delivered keys cannot be reassigned' USING ERRCODE = '23514';
  END IF;
  -- Every allocator and inventory mutation locks the same key row.
  SELECT * INTO key_row FROM "ActivationKey" WHERE "id" = NEW."keyId" FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Unknown activation key' USING ERRCODE = '23503'; END IF;
  IF key_row."disabledAt" IS NOT NULL THEN RAISE EXCEPTION 'Disabled activation key' USING ERRCODE = '23514'; END IF;
  SELECT i."quantity", o."status", o."mode" INTO item_quantity, order_status, order_mode
    FROM "OrderItem" i JOIN "Order" o ON o."id" = i."orderId"
    WHERE i."id" = NEW."orderItemId" FOR UPDATE OF i, o;
  IF NOT FOUND THEN RAISE EXCEPTION 'Unknown order item' USING ERRCODE = '23503'; END IF;
  IF order_status NOT IN ('VALIDATED', 'ASSIGNING') THEN RAISE EXCEPTION 'Order is not ready for key assignment' USING ERRCODE = '23514'; END IF;
  IF NEW."unitIndex" > item_quantity THEN RAISE EXCEPTION 'Unit exceeds the ordered quantity' USING ERRCODE = '23514'; END IF;
  IF key_row."isDemo" <> (order_mode = 'DEMO') THEN RAISE EXCEPTION 'Key and order modes differ' USING ERRCODE = '23514'; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "KeyAssignment_guard" BEFORE INSERT OR UPDATE OR DELETE ON "KeyAssignment" FOR EACH ROW EXECUTE FUNCTION guard_key_assignment();

CREATE FUNCTION guard_assigned_key() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM "KeyAssignment" WHERE "keyId" = OLD."id") AND
    (NEW."id", NEW."productId", NEW."ciphertext", NEW."fingerprint", NEW."encryptionKeyId", NEW."isDemo", NEW."disabledAt") IS DISTINCT FROM
    (OLD."id", OLD."productId", OLD."ciphertext", OLD."fingerprint", OLD."encryptionKeyId", OLD."isDemo", OLD."disabledAt") THEN
    RAISE EXCEPTION 'Delivered activation keys cannot be changed or disabled' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "ActivationKey_assigned_guard" BEFORE UPDATE ON "ActivationKey" FOR EACH ROW EXECUTE FUNCTION guard_assigned_key();

CREATE FUNCTION guard_order_item_snapshot() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE parent_status "OrderStatus";
BEGIN
  SELECT "status" INTO parent_status FROM "Order" WHERE "id" = CASE WHEN TG_OP = 'INSERT' THEN NEW."orderId" ELSE OLD."orderId" END FOR UPDATE;
  IF parent_status <> 'CREATING' THEN RAISE EXCEPTION 'Validated order item snapshots are immutable' USING ERRCODE = '23514'; END IF;
  IF TG_OP = 'UPDATE' AND NEW."orderId" <> OLD."orderId" THEN RAISE EXCEPTION 'Order items cannot be moved' USING ERRCODE = '23514'; END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "OrderItem_snapshot_guard" BEFORE INSERT OR UPDATE OR DELETE ON "OrderItem" FOR EACH ROW EXECUTE FUNCTION guard_order_item_snapshot();

CREATE FUNCTION guard_order_identity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW."id", NEW."reference", NEW."userId", NEW."idempotencyKey", NEW."requestHash", NEW."mode", NEW."createdAt") IS DISTINCT FROM
    (OLD."id", OLD."reference", OLD."userId", OLD."idempotencyKey", OLD."requestHash", OLD."mode", OLD."createdAt") THEN
    RAISE EXCEPTION 'Order identity and idempotency are immutable' USING ERRCODE = '23514';
  END IF;
  IF OLD."status" <> 'CREATING' AND
    (NEW."subtotalCents", NEW."totalCents", NEW."currency", NEW."customerEmail", NEW."discordUsername", NEW."locale") IS DISTINCT FROM
    (OLD."subtotalCents", OLD."totalCents", OLD."currency", OLD."customerEmail", OLD."discordUsername", OLD."locale") THEN
    RAISE EXCEPTION 'Validated order snapshots are immutable' USING ERRCODE = '23514';
  END IF;
  IF OLD."status" IN ('COMPLETED', 'FAILED') AND NEW."status" <> OLD."status" THEN RAISE EXCEPTION 'Terminal order status is immutable' USING ERRCODE = '23514'; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "Order_identity_guard" BEFORE UPDATE ON "Order" FOR EACH ROW EXECUTE FUNCTION guard_order_identity();

-- Deferred: the whole allocation must be committed together with the final status.
CREATE FUNCTION validate_order_completion() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE current_order "Order"%ROWTYPE;
BEGIN
  SELECT * INTO current_order FROM "Order" WHERE "id" = NEW."id";
  IF current_order."status" = 'COMPLETED' THEN
    IF current_order."completedAt" IS NULL OR NOT EXISTS (SELECT 1 FROM "OrderItem" WHERE "orderId" = current_order."id") THEN RAISE EXCEPTION 'A completed order needs items and a completion date' USING ERRCODE = '23514'; END IF;
    IF EXISTS (SELECT 1 FROM "OrderItem" i WHERE i."orderId" = current_order."id" AND i."quantity" <> (SELECT count(*) FROM "KeyAssignment" a WHERE a."orderItemId" = i."id")) THEN RAISE EXCEPTION 'Every ordered unit must have a distinct key before completion' USING ERRCODE = '23514'; END IF;
    IF current_order."subtotalCents" <> (SELECT sum("lineTotalCents") FROM "OrderItem" WHERE "orderId" = current_order."id") OR current_order."totalCents" <> current_order."subtotalCents" THEN RAISE EXCEPTION 'Order totals must match the V1 line snapshots' USING ERRCODE = '23514'; END IF;
    IF current_order."mode" = 'COMMERCIAL' AND current_order."paymentStatus" <> 'VERIFIED' THEN RAISE EXCEPTION 'Commercial order payment must be verified' USING ERRCODE = '23514'; END IF;
  ELSIF current_order."status" = 'FAILED' AND EXISTS (SELECT 1 FROM "KeyAssignment" a JOIN "OrderItem" i ON i."id" = a."orderItemId" WHERE i."orderId" = current_order."id") THEN
    RAISE EXCEPTION 'An order with delivered keys cannot be marked failed' USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END;
$$;
CREATE CONSTRAINT TRIGGER "Order_completion_guard" AFTER INSERT OR UPDATE ON "Order" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION validate_order_completion();

CREATE FUNCTION guard_order_event() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Order events are append-only' USING ERRCODE = '23514';
END;
$$;
CREATE TRIGGER "OrderEvent_append_only" BEFORE UPDATE OR DELETE ON "OrderEvent" FOR EACH ROW EXECUTE FUNCTION guard_order_event();
