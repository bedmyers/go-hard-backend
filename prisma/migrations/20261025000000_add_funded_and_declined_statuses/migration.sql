-- FUNDED was added to production directly (db push) without a migration.
-- IF NOT EXISTS makes this a no-op there and correct on fresh databases.
ALTER TYPE "EscrowStatus" ADD VALUE IF NOT EXISTS 'FUNDED';

-- Vendor declining an invitation previously wrote an invalid status.
ALTER TYPE "ProjectVendorStatus" ADD VALUE IF NOT EXISTS 'DECLINED';
