-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "EscrowStatus" ADD VALUE 'CANCEL_REQUESTED';
ALTER TYPE "EscrowStatus" ADD VALUE 'DISPUTED';
ALTER TYPE "EscrowStatus" ADD VALUE 'REFUNDED';

-- AlterTable
ALTER TABLE "Escrow" ADD COLUMN     "cancelReason" TEXT,
ADD COLUMN     "cancelRequestedAt" TIMESTAMP(3),
ADD COLUMN     "cancelRequestedById" INTEGER,
ADD COLUMN     "disputeReason" TEXT,
ADD COLUMN     "refundedAmountCents" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "stripeDisputeId" TEXT,
ADD COLUMN     "stripeRefundId" TEXT;

-- AlterTable
ALTER TABLE "Milestone" ADD COLUMN     "refunded" BOOLEAN NOT NULL DEFAULT false;

