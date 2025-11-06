-- CreateEnum
CREATE TYPE "UserType" AS ENUM ('CUSTOMER', 'VENDOR', 'BOTH');

-- CreateEnum
CREATE TYPE "EscrowStatus" AS ENUM ('PENDING', 'AUTHORIZED', 'COMPLETE', 'CANCELED');

-- CreateEnum
CREATE TYPE "ProjectStatus" AS ENUM ('PLANNING', 'ACTIVE', 'COMPLETED', 'CANCELED');

-- CreateEnum
CREATE TYPE "ProjectVendorStatus" AS ENUM ('INVITED', 'ACCEPTED', 'PAID', 'COMPLETED', 'CANCELED');

-- CreateTable
CREATE TABLE "User" (
    "id" SERIAL NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "password" TEXT NOT NULL,
    "userType" "UserType" NOT NULL DEFAULT 'CUSTOMER',
    "stripeAccountId" TEXT,
    "bio" TEXT,
    "services" TEXT[],
    "portfolioUrls" TEXT[],
    "location" TEXT,
    "phoneNumber" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Project" (
    "id" SERIAL NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "totalBudget" INTEGER,
    "eventDate" TIMESTAMP(3),
    "location" TEXT,
    "pinterestBoard" TEXT,
    "status" "ProjectStatus" NOT NULL DEFAULT 'PLANNING',
    "customerId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Project_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectVendor" (
    "id" SERIAL NOT NULL,
    "projectId" INTEGER NOT NULL,
    "vendorId" INTEGER NOT NULL,
    "role" TEXT NOT NULL,
    "description" TEXT,
    "amountCents" INTEGER NOT NULL,
    "dueDate" TIMESTAMP(3),
    "status" "ProjectVendorStatus" NOT NULL DEFAULT 'INVITED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProjectVendor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Escrow" (
    "id" SERIAL NOT NULL,
    "projectVendorId" INTEGER NOT NULL,
    "buyerId" INTEGER NOT NULL,
    "sellerId" INTEGER NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "status" "EscrowStatus" NOT NULL DEFAULT 'PENDING',
    "stripePaymentIntentId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Escrow_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Milestone" (
    "id" SERIAL NOT NULL,
    "escrowId" INTEGER NOT NULL,
    "description" TEXT,
    "amountCents" INTEGER NOT NULL,
    "releaseConditions" TEXT,
    "dueDate" TIMESTAMP(3),
    "released" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Milestone_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "User_stripeAccountId_key" ON "User"("stripeAccountId");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectVendor_projectId_vendorId_key" ON "ProjectVendor"("projectId", "vendorId");

-- CreateIndex
CREATE UNIQUE INDEX "Escrow_projectVendorId_key" ON "Escrow"("projectVendorId");

-- AddForeignKey
ALTER TABLE "Project" ADD CONSTRAINT "Project_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectVendor" ADD CONSTRAINT "ProjectVendor_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectVendor" ADD CONSTRAINT "ProjectVendor_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Escrow" ADD CONSTRAINT "Escrow_projectVendorId_fkey" FOREIGN KEY ("projectVendorId") REFERENCES "ProjectVendor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Escrow" ADD CONSTRAINT "Escrow_buyerId_fkey" FOREIGN KEY ("buyerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Escrow" ADD CONSTRAINT "Escrow_sellerId_fkey" FOREIGN KEY ("sellerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Milestone" ADD CONSTRAINT "Milestone_escrowId_fkey" FOREIGN KEY ("escrowId") REFERENCES "Escrow"("id") ON DELETE CASCADE ON UPDATE CASCADE;
