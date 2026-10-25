-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "GuildConfig" (
    "guildId" TEXT NOT NULL,
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "leftAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GuildConfig_pkey" PRIMARY KEY ("guildId")
);

-- CreateTable
CREATE TABLE "TempVoiceConfig" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "categoryId" TEXT NOT NULL,
    "creatorChannelId" TEXT NOT NULL,
    "emptyDeleteDelaySec" INTEGER NOT NULL DEFAULT 10,
    "ownerGraceSec" INTEGER NOT NULL DEFAULT 30,
    "maxRoomsPerMember" INTEGER NOT NULL DEFAULT 1,
    "defaultUserLimit" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TempVoiceConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TempVoiceRoom" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "locked" BOOLEAN NOT NULL DEFAULT false,
    "hidden" BOOLEAN NOT NULL DEFAULT false,
    "userLimit" INTEGER NOT NULL DEFAULT 0,
    "ownerLeftAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TempVoiceRoom_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RoomMemberRestriction" (
    "id" TEXT NOT NULL,
    "roomId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RoomMemberRestriction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RoomAllowedMember" (
    "id" TEXT NOT NULL,
    "roomId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RoomAllowedMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GuardConfig" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "mode" TEXT NOT NULL DEFAULT 'ALERT',
    "activatedById" TEXT,
    "activatedAt" TIMESTAMP(3),
    "incidentCooldownSec" INTEGER NOT NULL DEFAULT 300,
    "logRetentionDays" INTEGER NOT NULL DEFAULT 90,
    "notifyOwner" BOOLEAN NOT NULL DEFAULT true,
    "notifyRoleIds" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GuardConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GuardModuleConfig" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "module" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "warnThreshold" INTEGER NOT NULL,
    "threshold" INTEGER NOT NULL,
    "windowSec" INTEGER NOT NULL,
    "severity" TEXT NOT NULL DEFAULT 'CRITICAL',
    "autoStrip" BOOLEAN NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GuardModuleConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrustedExecutor" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "addedById" TEXT NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TrustedExecutor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GuardManager" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "addedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GuardManager_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SecurityEvent" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "module" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "auditEntryId" TEXT,
    "executorId" TEXT,
    "executorVerified" BOOLEAN NOT NULL DEFAULT false,
    "targetId" TEXT,
    "targetType" TEXT,
    "targetName" TEXT,
    "details" TEXT NOT NULL DEFAULT '{}',
    "severity" TEXT NOT NULL,
    "actionTaken" TEXT NOT NULL DEFAULT 'NONE',
    "actionSucceeded" BOOLEAN,
    "incidentId" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SecurityEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SecurityIncident" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "executorId" TEXT NOT NULL,
    "module" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "mode" TEXT NOT NULL,
    "dedupeKey" TEXT NOT NULL,
    "eventCount" INTEGER NOT NULL,
    "windowSec" INTEGER NOT NULL,
    "actionTaken" TEXT NOT NULL,
    "actionSucceeded" BOOLEAN NOT NULL,
    "failureReason" TEXT,
    "restoredAt" TIMESTAMP(3),
    "restoredById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SecurityIncident_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SecurityIncidentRoleSnapshot" (
    "id" TEXT NOT NULL,
    "incidentId" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,
    "roleName" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "privileged" BOOLEAN NOT NULL DEFAULT false,
    "removed" BOOLEAN NOT NULL DEFAULT false,
    "failureReason" TEXT,
    "restored" BOOLEAN NOT NULL DEFAULT false,
    "restoredAt" TIMESTAMP(3),

    CONSTRAINT "SecurityIncidentRoleSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LogChannelConfig" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "recoveryCount" INTEGER NOT NULL DEFAULT 0,
    "recoveryWindowStart" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LogChannelConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommandAuditLog" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "command" TEXT NOT NULL,
    "options" TEXT NOT NULL DEFAULT '{}',
    "success" BOOLEAN NOT NULL,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CommandAuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TempVoiceConfig_guildId_key" ON "TempVoiceConfig"("guildId");

-- CreateIndex
CREATE UNIQUE INDEX "TempVoiceConfig_creatorChannelId_key" ON "TempVoiceConfig"("creatorChannelId");

-- CreateIndex
CREATE UNIQUE INDEX "TempVoiceRoom_channelId_key" ON "TempVoiceRoom"("channelId");

-- CreateIndex
CREATE INDEX "TempVoiceRoom_guildId_idx" ON "TempVoiceRoom"("guildId");

-- CreateIndex
CREATE INDEX "TempVoiceRoom_guildId_ownerId_idx" ON "TempVoiceRoom"("guildId", "ownerId");

-- CreateIndex
CREATE INDEX "TempVoiceRoom_ownerId_idx" ON "TempVoiceRoom"("ownerId");

-- CreateIndex
CREATE INDEX "RoomMemberRestriction_userId_idx" ON "RoomMemberRestriction"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "RoomMemberRestriction_roomId_userId_key" ON "RoomMemberRestriction"("roomId", "userId");

-- CreateIndex
CREATE INDEX "RoomAllowedMember_userId_idx" ON "RoomAllowedMember"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "RoomAllowedMember_roomId_userId_key" ON "RoomAllowedMember"("roomId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "GuardConfig_guildId_key" ON "GuardConfig"("guildId");

-- CreateIndex
CREATE UNIQUE INDEX "GuardModuleConfig_guildId_module_key" ON "GuardModuleConfig"("guildId", "module");

-- CreateIndex
CREATE INDEX "TrustedExecutor_guildId_idx" ON "TrustedExecutor"("guildId");

-- CreateIndex
CREATE UNIQUE INDEX "TrustedExecutor_guildId_targetId_type_key" ON "TrustedExecutor"("guildId", "targetId", "type");

-- CreateIndex
CREATE UNIQUE INDEX "GuardManager_guildId_userId_key" ON "GuardManager"("guildId", "userId");

-- CreateIndex
CREATE INDEX "SecurityEvent_guildId_occurredAt_idx" ON "SecurityEvent"("guildId", "occurredAt");

-- CreateIndex
CREATE INDEX "SecurityEvent_executorId_idx" ON "SecurityEvent"("executorId");

-- CreateIndex
CREATE INDEX "SecurityEvent_auditEntryId_idx" ON "SecurityEvent"("auditEntryId");

-- CreateIndex
CREATE INDEX "SecurityEvent_incidentId_idx" ON "SecurityEvent"("incidentId");

-- CreateIndex
CREATE UNIQUE INDEX "SecurityEvent_guildId_auditEntryId_key" ON "SecurityEvent"("guildId", "auditEntryId");

-- CreateIndex
CREATE UNIQUE INDEX "SecurityIncident_dedupeKey_key" ON "SecurityIncident"("dedupeKey");

-- CreateIndex
CREATE INDEX "SecurityIncident_guildId_createdAt_idx" ON "SecurityIncident"("guildId", "createdAt");

-- CreateIndex
CREATE INDEX "SecurityIncident_guildId_executorId_idx" ON "SecurityIncident"("guildId", "executorId");

-- CreateIndex
CREATE INDEX "SecurityIncidentRoleSnapshot_roleId_idx" ON "SecurityIncidentRoleSnapshot"("roleId");

-- CreateIndex
CREATE UNIQUE INDEX "SecurityIncidentRoleSnapshot_incidentId_roleId_key" ON "SecurityIncidentRoleSnapshot"("incidentId", "roleId");

-- CreateIndex
CREATE INDEX "LogChannelConfig_channelId_idx" ON "LogChannelConfig"("channelId");

-- CreateIndex
CREATE UNIQUE INDEX "LogChannelConfig_guildId_kind_key" ON "LogChannelConfig"("guildId", "kind");

-- CreateIndex
CREATE INDEX "CommandAuditLog_guildId_createdAt_idx" ON "CommandAuditLog"("guildId", "createdAt");

-- CreateIndex
CREATE INDEX "CommandAuditLog_userId_idx" ON "CommandAuditLog"("userId");

-- AddForeignKey
ALTER TABLE "TempVoiceConfig" ADD CONSTRAINT "TempVoiceConfig_guildId_fkey" FOREIGN KEY ("guildId") REFERENCES "GuildConfig"("guildId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoomMemberRestriction" ADD CONSTRAINT "RoomMemberRestriction_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "TempVoiceRoom"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoomAllowedMember" ADD CONSTRAINT "RoomAllowedMember_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "TempVoiceRoom"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GuardConfig" ADD CONSTRAINT "GuardConfig_guildId_fkey" FOREIGN KEY ("guildId") REFERENCES "GuildConfig"("guildId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GuardModuleConfig" ADD CONSTRAINT "GuardModuleConfig_guildId_fkey" FOREIGN KEY ("guildId") REFERENCES "GuildConfig"("guildId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrustedExecutor" ADD CONSTRAINT "TrustedExecutor_guildId_fkey" FOREIGN KEY ("guildId") REFERENCES "GuildConfig"("guildId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GuardManager" ADD CONSTRAINT "GuardManager_guildId_fkey" FOREIGN KEY ("guildId") REFERENCES "GuildConfig"("guildId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SecurityEvent" ADD CONSTRAINT "SecurityEvent_incidentId_fkey" FOREIGN KEY ("incidentId") REFERENCES "SecurityIncident"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SecurityIncidentRoleSnapshot" ADD CONSTRAINT "SecurityIncidentRoleSnapshot_incidentId_fkey" FOREIGN KEY ("incidentId") REFERENCES "SecurityIncident"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LogChannelConfig" ADD CONSTRAINT "LogChannelConfig_guildId_fkey" FOREIGN KEY ("guildId") REFERENCES "GuildConfig"("guildId") ON DELETE CASCADE ON UPDATE CASCADE;

