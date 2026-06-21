-- CreateTable
CREATE TABLE "UserProductEvent" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "anonymousId" TEXT,
    "barcode" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "weight" INTEGER NOT NULL,
    "source" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserProductEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "UserProductEvent_userId_createdAt_idx" ON "UserProductEvent"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "UserProductEvent_anonymousId_createdAt_idx" ON "UserProductEvent"("anonymousId", "createdAt");

-- CreateIndex
CREATE INDEX "UserProductEvent_barcode_idx" ON "UserProductEvent"("barcode");

-- CreateIndex
CREATE INDEX "UserProductEvent_eventType_idx" ON "UserProductEvent"("eventType");

-- CreateIndex
CREATE INDEX "UserProductEvent_createdAt_idx" ON "UserProductEvent"("createdAt");

-- AddForeignKey
ALTER TABLE "UserProductEvent" ADD CONSTRAINT "UserProductEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
