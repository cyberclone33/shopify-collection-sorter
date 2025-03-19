-- CreateTable
CREATE TABLE "SortedCollection" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "collectionId" TEXT NOT NULL,
    "collectionTitle" TEXT NOT NULL,
    "sortedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE UNIQUE INDEX "SortedCollection_shop_collectionId_key" ON "SortedCollection"("shop", "collectionId");
