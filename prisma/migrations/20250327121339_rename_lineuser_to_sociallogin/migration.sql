-- CreateTable
CREATE TABLE "SocialLogin" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "lineId" TEXT,
    "lineAccessToken" TEXT,
    "lineRefreshToken" TEXT,
    "googleId" TEXT,
    "googleAccessToken" TEXT,
    "googleRefreshToken" TEXT,
    "tokenExpiresAt" DATETIME,
    "displayName" TEXT,
    "pictureUrl" TEXT,
    "email" TEXT,
    "shopifyCustomerId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "SocialLogin_shop_provider_lineId_key" ON "SocialLogin"("shop", "provider", "lineId");

-- CreateIndex
CREATE UNIQUE INDEX "SocialLogin_shop_provider_googleId_key" ON "SocialLogin"("shop", "provider", "googleId");
