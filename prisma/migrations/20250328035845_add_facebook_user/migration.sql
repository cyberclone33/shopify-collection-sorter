-- CreateTable
CREATE TABLE "FacebookUser" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "facebookId" TEXT NOT NULL,
    "facebookAccessToken" TEXT,
    "tokenExpiresAt" DATETIME,
    "displayName" TEXT,
    "pictureUrl" TEXT,
    "email" TEXT,
    "shopifyCustomerId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "FacebookUser_shop_facebookId_key" ON "FacebookUser"("shop", "facebookId");
