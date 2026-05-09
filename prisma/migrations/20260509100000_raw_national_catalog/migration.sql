-- CreateTable
CREATE TABLE "NationalCatalogRawProduct" (
    "id" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "sourceUrl" TEXT NOT NULL,
    "barcode" TEXT,
    "payload" JSONB NOT NULL,
    "scrapedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NationalCatalogRawProduct_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "NationalCatalogRawProduct_sourceUrl_key" ON "NationalCatalogRawProduct"("sourceUrl");

-- CreateIndex
CREATE INDEX "NationalCatalogRawProduct_barcode_idx" ON "NationalCatalogRawProduct"("barcode");

-- CreateIndex
CREATE INDEX "NationalCatalogRawProduct_source_idx" ON "NationalCatalogRawProduct"("source");

-- CreateIndex
CREATE INDEX "NationalCatalogRawProduct_scrapedAt_idx" ON "NationalCatalogRawProduct"("scrapedAt" DESC);
