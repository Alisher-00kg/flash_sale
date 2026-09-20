UPDATE "Order"
SET "reservedUntil" = "createdAt"
WHERE "reservedUntil" IS NULL;

ALTER TABLE "Order"
ALTER COLUMN "reservedUntil" SET NOT NULL;