-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_SortedCollection" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "collectionId" TEXT NOT NULL,
    "collectionTitle" TEXT NOT NULL,
    "sortedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sortOrder" TEXT NOT NULL DEFAULT 'MANUAL'
);
INSERT INTO "new_SortedCollection" ("collectionId", "collectionTitle", "id", "shop", "sortedAt") SELECT "collectionId", "collectionTitle", "id", "shop", "sortedAt" FROM "SortedCollection";
DROP TABLE "SortedCollection";
ALTER TABLE "new_SortedCollection" RENAME TO "SortedCollection";
CREATE UNIQUE INDEX "SortedCollection_shop_collectionId_key" ON "SortedCollection"("shop", "collectionId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
