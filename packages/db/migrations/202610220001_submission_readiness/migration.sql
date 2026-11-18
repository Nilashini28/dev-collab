CREATE TABLE "SubmissionItem" (
 "id" TEXT NOT NULL, "projectId" TEXT NOT NULL, "title" TEXT NOT NULL,
 "kind" TEXT NOT NULL DEFAULT 'CUSTOM', "templateKey" TEXT,
 "required" BOOLEAN NOT NULL DEFAULT true, "done" BOOLEAN NOT NULL DEFAULT false,
 "ownerId" TEXT, "url" TEXT, "wikiPageId" TEXT, "notes" TEXT NOT NULL DEFAULT '',
 "version" INTEGER NOT NULL DEFAULT 1, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "updatedAt" TIMESTAMP(3) NOT NULL,
 CONSTRAINT "SubmissionItem_pkey" PRIMARY KEY ("id"),
 CONSTRAINT "SubmissionItem_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "SubmissionItem_projectId_templateKey_key" ON "SubmissionItem"("projectId","templateKey");
CREATE INDEX "SubmissionItem_projectId_createdAt_id_idx" ON "SubmissionItem"("projectId","createdAt","id");
ALTER TABLE "SubmissionItem" ADD CONSTRAINT "SubmissionItem_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "SubmissionItem" ADD CONSTRAINT "SubmissionItem_wikiPageId_fkey" FOREIGN KEY ("wikiPageId") REFERENCES "WikiPage"("id") ON DELETE SET NULL ON UPDATE CASCADE;
