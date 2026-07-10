-- Phase: local image migration (scripts/migrate-product-images.ts)
-- Additive, non-destructive. Preserves the original external imageUrl before
-- it is rewritten to a local /product-images/... URL.

-- AlterTable
ALTER TABLE "Product" ADD COLUMN "sourceImageUrl" TEXT;
