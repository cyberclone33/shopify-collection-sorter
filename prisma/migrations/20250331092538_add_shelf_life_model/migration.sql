-- CreateTable
CREATE TABLE "ShelfLifeItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "expirationDate" DATETIME NOT NULL,
    "quantity" INTEGER NOT NULL,
    "location" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "ShelfLifeItem_productId_batchId_key" ON "ShelfLifeItem"("productId", "batchId");
