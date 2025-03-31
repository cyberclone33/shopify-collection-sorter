-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_ShelfLifeItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "expirationDate" DATETIME NOT NULL,
    "totalQuantity" INTEGER,
    "batchQuantity" INTEGER,
    "quantity" INTEGER,
    "location" TEXT,
    "shopifyProductId" TEXT,
    "shopifyVariantId" TEXT,
    "shopifyProductTitle" TEXT,
    "shopifyVariantTitle" TEXT,
    "syncStatus" TEXT,
    "syncMessage" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- Copy data from the old table to the new table, using quantity for both totalQuantity and batchQuantity
INSERT INTO "new_ShelfLifeItem" (
    "id", "shop", "productId", "batchId", "expirationDate", 
    "totalQuantity", "batchQuantity", "quantity",
    "location", "shopifyProductId", "shopifyProductTitle", 
    "shopifyVariantId", "shopifyVariantTitle", "syncStatus", 
    "syncMessage", "createdAt", "updatedAt"
) 
SELECT 
    "id", "shop", "productId", "batchId", "expirationDate", 
    "quantity", "quantity", "quantity",
    "location", "shopifyProductId", "shopifyProductTitle", 
    "shopifyVariantId", "shopifyVariantTitle", "syncStatus", 
    "syncMessage", "createdAt", "updatedAt" 
FROM "ShelfLifeItem";

DROP TABLE "ShelfLifeItem";
ALTER TABLE "new_ShelfLifeItem" RENAME TO "ShelfLifeItem";
CREATE UNIQUE INDEX "ShelfLifeItem_productId_batchId_key" ON "ShelfLifeItem"("productId", "batchId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
