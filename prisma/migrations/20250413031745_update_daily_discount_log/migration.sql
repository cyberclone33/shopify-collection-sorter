-- CreateTable
CREATE TABLE "ShelfLifeItemPriceChange" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "shelfLifeItemId" TEXT,
    "shopifyVariantId" TEXT NOT NULL,
    "originalPrice" REAL NOT NULL,
    "originalCompareAtPrice" REAL,
    "newPrice" REAL NOT NULL,
    "newCompareAtPrice" REAL NOT NULL,
    "currencyCode" TEXT,
    "appliedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "appliedByUserId" TEXT,
    "appliedByUserName" TEXT,
    "status" TEXT NOT NULL DEFAULT 'APPLIED',
    "notes" TEXT,
    CONSTRAINT "ShelfLifeItemPriceChange_shelfLifeItemId_fkey" FOREIGN KEY ("shelfLifeItemId") REFERENCES "ShelfLifeItem" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "DailyDiscountLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "productTitle" TEXT NOT NULL,
    "variantId" TEXT NOT NULL,
    "variantTitle" TEXT,
    "originalPrice" REAL NOT NULL,
    "discountedPrice" REAL NOT NULL,
    "compareAtPrice" REAL,
    "costPrice" REAL,
    "profitMargin" REAL,
    "discountPercentage" REAL NOT NULL,
    "savingsAmount" REAL NOT NULL,
    "savingsPercentage" REAL NOT NULL,
    "currencyCode" TEXT NOT NULL DEFAULT 'USD',
    "appliedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "appliedByUserId" TEXT,
    "imageUrl" TEXT,
    "inventoryQuantity" INTEGER,
    "isRandomDiscount" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT
);

-- CreateIndex
CREATE INDEX "ShelfLifeItemPriceChange_shelfLifeItemId_idx" ON "ShelfLifeItemPriceChange"("shelfLifeItemId");

-- CreateIndex
CREATE INDEX "ShelfLifeItemPriceChange_shopifyVariantId_idx" ON "ShelfLifeItemPriceChange"("shopifyVariantId");

-- CreateIndex
CREATE INDEX "DailyDiscountLog_shop_idx" ON "DailyDiscountLog"("shop");

-- CreateIndex
CREATE INDEX "DailyDiscountLog_variantId_idx" ON "DailyDiscountLog"("variantId");

-- CreateIndex
CREATE INDEX "DailyDiscountLog_appliedAt_idx" ON "DailyDiscountLog"("appliedAt");
