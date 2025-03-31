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
INSERT INTO "new_ShelfLifeItem" ("batchId", "batchQuantity", "createdAt", "expirationDate", "id", "location", "productId", "shop", "shopifyProductId", "shopifyProductTitle", "shopifyVariantId", "shopifyVariantTitle", "syncMessage", "syncStatus", "totalQuantity", "updatedAt") SELECT "batchId", "batchQuantity", "createdAt", "expirationDate", "id", "location", "productId", "shop", "shopifyProductId", "shopifyProductTitle", "shopifyVariantId", "shopifyVariantTitle", "syncMessage", "syncStatus", "totalQuantity", "updatedAt" FROM "ShelfLifeItem";
DROP TABLE "ShelfLifeItem";
ALTER TABLE "new_ShelfLifeItem" RENAME TO "ShelfLifeItem";
CREATE UNIQUE INDEX "ShelfLifeItem_productId_batchId_key" ON "ShelfLifeItem"("productId", "batchId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
