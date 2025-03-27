/*
  Warnings:

  - You are about to drop the `SocialLogin` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE "SocialLogin";
PRAGMA foreign_keys=on;

-- CreateTable
CREATE TABLE "LineUser" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "lineId" TEXT NOT NULL,
    "lineAccessToken" TEXT,
    "lineRefreshToken" TEXT,
    "tokenExpiresAt" DATETIME,
    "displayName" TEXT,
    "pictureUrl" TEXT,
    "email" TEXT,
    "shopifyCustomerId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "GoogleUser" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "googleId" TEXT NOT NULL,
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
CREATE UNIQUE INDEX "LineUser_shop_lineId_key" ON "LineUser"("shop", "lineId");

-- CreateIndex
CREATE UNIQUE INDEX "GoogleUser_shop_googleId_key" ON "GoogleUser"("shop", "googleId");
