ALTER TABLE "Task" ADD COLUMN "requirement" TEXT NOT NULL DEFAULT '', ADD COLUMN "requirementWikiId" TEXT, ADD COLUMN "autoCompleteOnMerge" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "GitPullRequest" ADD COLUMN "reviewState" TEXT NOT NULL DEFAULT 'UNKNOWN', ADD COLUMN "reviewedAt" TIMESTAMP(3);
CREATE TABLE "TaskPullLink" ("id" TEXT NOT NULL, "taskId" TEXT NOT NULL, "pullId" TEXT, "url" TEXT NOT NULL, "number" INTEGER NOT NULL, "title" TEXT NOT NULL, "state" TEXT NOT NULL, "reviewState" TEXT NOT NULL DEFAULT 'UNKNOWN', "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, CONSTRAINT "TaskPullLink_pkey" PRIMARY KEY ("id"));
CREATE UNIQUE INDEX "TaskPullLink_taskId_url_key" ON "TaskPullLink"("taskId","url");
CREATE INDEX "TaskPullLink_pullId_idx" ON "TaskPullLink"("pullId");
ALTER TABLE "TaskPullLink" ADD CONSTRAINT "TaskPullLink_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "TaskPullLink" ADD CONSTRAINT "TaskPullLink_pullId_fkey" FOREIGN KEY ("pullId") REFERENCES "GitPullRequest"("id") ON DELETE SET NULL ON UPDATE CASCADE;
