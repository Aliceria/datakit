-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" DATETIME NOT NULL,
    "lastSeenAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleteAt" DATETIME,
    "activeInstanceId" TEXT,
    "ipHash" TEXT NOT NULL,
    "headSeq" INTEGER NOT NULL DEFAULT 0,
    "snapshotVersion" INTEGER NOT NULL DEFAULT 0,
    "snapshotSeq" INTEGER NOT NULL DEFAULT 0,
    "sourceMeta" TEXT NOT NULL,
    "exportState" TEXT NOT NULL DEFAULT '{}',
    "bytesUsed" INTEGER NOT NULL DEFAULT 0
);

-- CreateTable
CREATE TABLE "SnapshotManifest" (
    "sessionId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "data" BLOB NOT NULL,

    PRIMARY KEY ("sessionId", "version"),
    CONSTRAINT "SnapshotManifest_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "SnapshotChunk" (
    "sessionId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "tableId" TEXT NOT NULL,
    "chunkIndex" INTEGER NOT NULL,
    "data" BLOB NOT NULL,

    PRIMARY KEY ("sessionId", "version", "tableId", "chunkIndex"),
    CONSTRAINT "SnapshotChunk_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "OpLog" (
    "sessionId" TEXT NOT NULL,
    "seq" INTEGER NOT NULL,
    "opId" TEXT NOT NULL,
    "payload" BLOB NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY ("sessionId", "seq"),
    CONSTRAINT "OpLog_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ImportEvent" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "ipHash" TEXT NOT NULL,
    "at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE INDEX "Session_lastSeenAt_idx" ON "Session"("lastSeenAt");

-- CreateIndex
CREATE INDEX "Session_deleteAt_idx" ON "Session"("deleteAt");

-- CreateIndex
CREATE INDEX "Session_expiresAt_idx" ON "Session"("expiresAt");

-- CreateIndex
CREATE INDEX "Session_ipHash_idx" ON "Session"("ipHash");

-- CreateIndex
CREATE UNIQUE INDEX "OpLog_sessionId_opId_key" ON "OpLog"("sessionId", "opId");

-- CreateIndex
CREATE INDEX "ImportEvent_ipHash_at_idx" ON "ImportEvent"("ipHash", "at");
