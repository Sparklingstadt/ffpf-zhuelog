-- AlterTable
ALTER TABLE "LineLink" ADD COLUMN     "reviewNotifiedOn" DATE,
ADD COLUMN     "reviewNotify" BOOLEAN NOT NULL DEFAULT false;
