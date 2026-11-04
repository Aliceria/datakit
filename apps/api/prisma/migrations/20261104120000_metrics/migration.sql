-- CreateTable
CREATE TABLE "MetricsVisit" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "originHmac" TEXT,
    "maskedIp" TEXT,
    "classification" TEXT NOT NULL
);

-- CreateTable
CREATE TABLE "MetricsOriginLast" (
    "originHmac" TEXT NOT NULL PRIMARY KEY,
    "lastCountedAt" BIGINT NOT NULL
);

-- CreateTable
CREATE TABLE "MetricsSession" (
    "sessionHash" TEXT NOT NULL PRIMARY KEY,
    "classification" TEXT NOT NULL,
    "importId" INTEGER,
    "sourceFormat" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "MetricsImport" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sessionHash" TEXT,
    "originHmac" TEXT,
    "maskedIp" TEXT,
    "classification" TEXT NOT NULL,
    "format" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "ok" BOOLEAN NOT NULL,
    "errorCode" TEXT
);

-- CreateTable
CREATE TABLE "MetricsEdit" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "importId" INTEGER,
    "sessionHash" TEXT,
    "originHmac" TEXT,
    "maskedIp" TEXT,
    "classification" TEXT NOT NULL,
    "sourceFormat" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "tool" TEXT,
    "ok" BOOLEAN NOT NULL
);

-- CreateTable
CREATE TABLE "MetricsExport" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "importId" INTEGER,
    "sessionHash" TEXT,
    "originHmac" TEXT,
    "maskedIp" TEXT,
    "classification" TEXT NOT NULL,
    "sourceFormat" TEXT NOT NULL,
    "targetFormat" TEXT NOT NULL,
    "ok" BOOLEAN NOT NULL,
    "errorCode" TEXT
);

-- CreateTable
CREATE TABLE "MetricsDaily" (
    "day" TEXT NOT NULL,
    "classification" TEXT NOT NULL,
    "distinctOrigins" INTEGER NOT NULL,

    PRIMARY KEY ("day", "classification")
);

-- CreateTable
CREATE TABLE "MetricsAdminSession" (
    "tokenHash" TEXT NOT NULL PRIMARY KEY,
    "expiresAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE INDEX "MetricsVisit_at_idx" ON "MetricsVisit"("at");

-- CreateIndex
CREATE INDEX "MetricsVisit_originHmac_idx" ON "MetricsVisit"("originHmac");

-- CreateIndex
CREATE INDEX "MetricsSession_createdAt_idx" ON "MetricsSession"("createdAt");

-- CreateIndex
CREATE INDEX "MetricsImport_at_idx" ON "MetricsImport"("at");

-- CreateIndex
CREATE INDEX "MetricsImport_originHmac_idx" ON "MetricsImport"("originHmac");

-- CreateIndex
CREATE INDEX "MetricsImport_format_idx" ON "MetricsImport"("format");

-- CreateIndex
CREATE INDEX "MetricsEdit_at_idx" ON "MetricsEdit"("at");

-- CreateIndex
CREATE INDEX "MetricsEdit_originHmac_idx" ON "MetricsEdit"("originHmac");

-- CreateIndex
CREATE INDEX "MetricsEdit_tool_idx" ON "MetricsEdit"("tool");

-- CreateIndex
CREATE INDEX "MetricsEdit_importId_idx" ON "MetricsEdit"("importId");

-- CreateIndex
CREATE INDEX "MetricsExport_at_idx" ON "MetricsExport"("at");

-- CreateIndex
CREATE INDEX "MetricsExport_originHmac_idx" ON "MetricsExport"("originHmac");

-- CreateIndex
CREATE INDEX "MetricsExport_sourceFormat_targetFormat_idx" ON "MetricsExport"("sourceFormat", "targetFormat");

-- CreateIndex
CREATE INDEX "MetricsExport_importId_idx" ON "MetricsExport"("importId");

-- CreateIndex
CREATE INDEX "MetricsAdminSession_expiresAt_idx" ON "MetricsAdminSession"("expiresAt");
