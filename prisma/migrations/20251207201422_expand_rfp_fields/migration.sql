-- CreateEnum
CREATE TYPE "RFPVisibility" AS ENUM ('PUBLIC', 'PRIVATE');

-- AlterTable
ALTER TABLE "RFP" ADD COLUMN     "decisionDate" TIMESTAMP(3),
ADD COLUMN     "eventDate" TIMESTAMP(3),
ADD COLUMN     "guestCount" INTEGER,
ADD COLUMN     "inspirationUrl" TEXT,
ADD COLUMN     "invitedVendorIds" INTEGER[],
ADD COLUMN     "location" TEXT,
ADD COLUMN     "mustHaves" TEXT[],
ADD COLUMN     "niceToHaves" TEXT[],
ADD COLUMN     "styleTags" TEXT[],
ADD COLUMN     "visibility" "RFPVisibility" NOT NULL DEFAULT 'PUBLIC';
