-- CreateTable
CREATE TABLE "SuspectRecord" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "userTag" TEXT,
    "moderatorId" TEXT NOT NULL,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SuspectRecord_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SuspectRecord_guildId_idx" ON "SuspectRecord"("guildId");

-- CreateIndex
CREATE UNIQUE INDEX "SuspectRecord_guildId_userId_key" ON "SuspectRecord"("guildId", "userId");
