-- CreateTable
CREATE TABLE "YargiRecord" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "userTag" TEXT,
    "moderatorId" TEXT NOT NULL,
    "reason" TEXT,
    "rebanCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "YargiRecord_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "YargiRecord_guildId_idx" ON "YargiRecord"("guildId");

-- CreateIndex
CREATE UNIQUE INDEX "YargiRecord_guildId_userId_key" ON "YargiRecord"("guildId", "userId");

