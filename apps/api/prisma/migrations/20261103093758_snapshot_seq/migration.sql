-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_SnapshotManifest" (
    "sessionId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "seq" INTEGER NOT NULL DEFAULT 0,
    "data" BLOB NOT NULL,

    PRIMARY KEY ("sessionId", "version"),
    CONSTRAINT "SnapshotManifest_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_SnapshotManifest" ("data", "sessionId", "version") SELECT "data", "sessionId", "version" FROM "SnapshotManifest";
DROP TABLE "SnapshotManifest";
ALTER TABLE "new_SnapshotManifest" RENAME TO "SnapshotManifest";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
