CREATE TABLE "AuthRateLimit" (
  "key" CHAR(64) PRIMARY KEY,
  "hits" INTEGER NOT NULL CHECK ("hits" > 0),
  "expiresAt" TIMESTAMPTZ(3) NOT NULL
);
CREATE INDEX "AuthRateLimit_expiresAt_idx" ON "AuthRateLimit"("expiresAt");
CREATE TABLE "AuthSecurityState" (
  "id" TEXT PRIMARY KEY CHECK ("id" = 'admin-roles'),
  "revision" BIGINT NOT NULL DEFAULT 0
);
INSERT INTO "AuthSecurityState" ("id") VALUES ('admin-roles');

CREATE FUNCTION guard_user_security() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE old_admin boolean := false; new_admin boolean := false;
BEGIN
  IF TG_OP <> 'INSERT' THEN old_admin := OLD."role" = 'ADMIN' AND OLD."active"; END IF;
  IF TG_OP <> 'DELETE' THEN new_admin := NEW."role" = 'ADMIN' AND NEW."active"; END IF;
  IF old_admin OR new_admin THEN
    -- A real write serializes mutations even under REPEATABLE READ.
    UPDATE "AuthSecurityState" SET "revision" = "revision" + 1 WHERE "id" = 'admin-roles';
    IF NOT FOUND THEN RAISE EXCEPTION 'Missing administrator security guard' USING ERRCODE = '23514'; END IF;
    IF old_admin AND NOT new_admin AND (SELECT count(*) FROM "User" WHERE "role" = 'ADMIN' AND "active") <= 1 THEN
      RAISE EXCEPTION 'The last active administrator cannot be removed or demoted' USING ERRCODE = '23514';
    END IF;
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF (NEW."role", NEW."active", NEW."passwordHash") IS DISTINCT FROM (OLD."role", OLD."active", OLD."passwordHash") THEN
      NEW."sessionVersion" := greatest(OLD."sessionVersion" + 1, NEW."sessionVersion");
    ELSIF NEW."sessionVersion" < OLD."sessionVersion" THEN
      RAISE EXCEPTION 'Session versions cannot decrease' USING ERRCODE = '23514';
    END IF;
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "User_security_guard" BEFORE INSERT OR UPDATE OR DELETE ON "User" FOR EACH ROW EXECUTE FUNCTION guard_user_security();
