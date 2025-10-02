-- AlterTable
ALTER TABLE "Milestone" ADD COLUMN     "description" TEXT,
ADD COLUMN     "dueDate" TIMESTAMP(3),
ADD COLUMN     "releaseConditions" TEXT;
