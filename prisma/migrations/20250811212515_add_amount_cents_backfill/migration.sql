-- 1) Add as NULLable first
ALTER TABLE "Escrow"    ADD COLUMN "amountCents" INTEGER;
ALTER TABLE "Milestone" ADD COLUMN "amountCents" INTEGER;

-- 2) Backfill from old dollar columns if they exist (else leave NULL for now)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'Escrow' AND column_name = 'amount'
  ) THEN
    EXECUTE 'UPDATE "Escrow" SET "amountCents" = ROUND("amount" * 100)::int';
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'Milestone' AND column_name = 'amount'
  ) THEN
    EXECUTE 'UPDATE "Milestone" SET "amountCents" = ROUND("amount" * 100)::int';
  END IF;
END$$;

-- 3) Ensure nothing is NULL (default 0 where we don't have old amounts)
ALTER TABLE "Escrow"    ALTER COLUMN "amountCents" SET DEFAULT 0;
ALTER TABLE "Milestone" ALTER COLUMN "amountCents" SET DEFAULT 0;

UPDATE "Escrow"    SET "amountCents" = 0 WHERE "amountCents" IS NULL;
UPDATE "Milestone" SET "amountCents" = 0 WHERE "amountCents" IS NULL;

-- 4) Now enforce NOT NULL and drop the temporary defaults
ALTER TABLE "Escrow"    ALTER COLUMN "amountCents" SET NOT NULL;
ALTER TABLE "Milestone" ALTER COLUMN "amountCents" SET NOT NULL;

ALTER TABLE "Escrow"    ALTER COLUMN "amountCents" DROP DEFAULT;
ALTER TABLE "Milestone" ALTER COLUMN "amountCents" DROP DEFAULT;

-- 5) Drop old Float columns if they still exist
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'Escrow' AND column_name = 'amount'
  ) THEN
    EXECUTE 'ALTER TABLE "Escrow" DROP COLUMN "amount"';
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'Milestone' AND column_name = 'amount'
  ) THEN
    EXECUTE 'ALTER TABLE "Milestone" DROP COLUMN "amount"';
  END IF;
END$$;

