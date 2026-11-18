-- CreateTable
CREATE TABLE "DeadlineProposal" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "sourceUrl" TEXT NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'QUEUED',
    "excerpt" TEXT,
    "candidates" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "errorCode" TEXT,
    "fetchedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DeadlineProposal_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DeadlineProposal_state_createdAt_idx" ON "DeadlineProposal"("state", "createdAt");

-- CreateIndex
CREATE INDEX "DeadlineProposal_projectId_createdAt_idx" ON "DeadlineProposal"("projectId", "createdAt");

-- AddForeignKey
ALTER TABLE "DeadlineProposal" ADD CONSTRAINT "DeadlineProposal_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
