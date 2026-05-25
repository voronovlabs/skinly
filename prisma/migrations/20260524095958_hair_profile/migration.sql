-- CreateEnum
CREATE TYPE "HairType" AS ENUM ('STRAIGHT', 'WAVY', 'CURLY', 'COILY');

-- CreateEnum
CREATE TYPE "ScalpType" AS ENUM ('NORMAL', 'DRY', 'OILY', 'SENSITIVE');

-- CreateEnum
CREATE TYPE "HairConcern" AS ENUM ('FRIZZ', 'DAMAGE', 'HAIR_LOSS', 'DANDRUFF', 'DULLNESS', 'SPLIT_ENDS');

-- CreateEnum
CREATE TYPE "HaircareGoal" AS ENUM ('HYDRATION', 'VOLUME', 'REPAIR', 'GROWTH', 'COLOR_PROTECTION', 'ANTI_FRIZZ');

-- CreateTable
CREATE TABLE "HairProfile" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "hairType" "HairType" NOT NULL,
    "scalpType" "ScalpType" NOT NULL,
    "concerns" "HairConcern"[],
    "goal" "HaircareGoal" NOT NULL,
    "completion" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HairProfile_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "HairProfile_userId_key" ON "HairProfile"("userId");

-- AddForeignKey
ALTER TABLE "HairProfile" ADD CONSTRAINT "HairProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
