-- CreateEnum
CREATE TYPE "RFPStatus" AS ENUM ('OPEN', 'AWARDED', 'CLOSED');

-- CreateEnum
CREATE TYPE "BidStatus" AS ENUM ('SUBMITTED', 'ACCEPTED', 'REJECTED');

-- CreateTable
CREATE TABLE "RFP" (
    "id" SERIAL NOT NULL,
    "projectId" INTEGER NOT NULL,
    "customerId" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "budget" INTEGER,
    "deadline" TIMESTAMP(3),
    "status" "RFPStatus" NOT NULL DEFAULT 'OPEN',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RFP_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Bid" (
    "id" SERIAL NOT NULL,
    "rfpId" INTEGER NOT NULL,
    "vendorId" INTEGER NOT NULL,
    "amount" INTEGER NOT NULL,
    "proposal" TEXT NOT NULL,
    "status" "BidStatus" NOT NULL DEFAULT 'SUBMITTED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Bid_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Bid_rfpId_vendorId_key" ON "Bid"("rfpId", "vendorId");

-- AddForeignKey
ALTER TABLE "RFP" ADD CONSTRAINT "RFP_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RFP" ADD CONSTRAINT "RFP_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Bid" ADD CONSTRAINT "Bid_rfpId_fkey" FOREIGN KEY ("rfpId") REFERENCES "RFP"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Bid" ADD CONSTRAINT "Bid_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
