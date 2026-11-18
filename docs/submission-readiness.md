# Module 1 — Submission readiness center

Open a workspace project → **Submission readiness**. This module reuses project repository/demo URLs, the existing confirmed deadline, project wiki pages, membership and audit infrastructure. It adds one project-scoped SubmissionItem table through the additive 202610220001_submission_readiness migration. Existing tasks, deadlines, submissions, memberships and wiki pages are preserved.

## Workflow

1. Confirm the final submission deadline through **Manage deadline**, which opens the existing project dashboard deadline editor. The event end date is never silently used as the submission deadline. The summary shows the confirmed instant in its saved IANA time zone and the remaining time.
2. A workspace owner/admin adds deliverables, or explicitly uses **Add starter checklist**. The starter suggests repository, demo, pitch deck, architecture and final form review; it is an editable team template, not a claim about official hackathon requirements. Repeated starter requests preserve edits and avoid duplicate template items.
3. Assign each required item to an active non-viewer teammate. Attach an HTTPS evidence URL, or select an architecture page from this project's wiki. Repository/demo items fall back to the existing project links unless explicitly overridden. Pitch files can be hosted in an approved location and linked; this module does not add another upload provider.
4. Assigned teammates confirm their own items. Leaders can edit, assign and confirm any item; viewers read/export only. A confirmation without a required link, valid architecture page or active owner remains flagged. Removing a teammate or changing them to viewer makes their items need attention again.
5. Required-ready counts and missing-item explanations update from the server. Optional incomplete items do not block readiness. A missing confirmed deadline, an empty required list, or a passed deadline prevents an internally-ready state. Missing official website/deadline source URLs are explicit warnings.
6. **Export summary** downloads a Markdown or JSON snapshot containing the schedule, project links, deliverables, owners, evidence, blockers, and team submission status. Wiki references point to the authenticated project page. Exports do not submit anything or change project status.
7. Complete the actual entry on the official hackathon website. The existing dashboard **Mark submitted** action remains the explicit record of your team's confirmation; no automatic submission or status changes were introduced.

## Safety and limits

Every API route enforces project/workspace membership. Writes serialize under the existing workspace lock and recheck permissions. Owner-only confirmation is enforced on the server. Owners and architecture pages are validated against the correct workspace/project. IDs cannot be used to modify an item from another project. Versions reject concurrent/stale edits and deletes. Owner/wiki references have foreign keys; removing a checklist item preserves linked wiki pages and evidence files. Maximum 100 deliverables per project; the page selector lists up to 500 recently updated wiki pages. Evidence links are not fetched or claimed to be working merely because a URL exists; readiness records human confirmation.

## Local setup

No new API keys or providers. Run `npm run db:generate` and `npm run db:migrate`, then restart the API and run the existing frontend. The migration only adds the readiness table, indexes and references. For other checkouts, apply the migration before opening this module. Existing reminders still use the configured worker; this module does not send external reminders.

## Module sequence

This is the first requested improvement. Task-to-GitHub traceability is delivered separately in the [traceability module](task-github-traceability.md). AI source navigation/evaluations is the following module; it is not represented as completed.

## Verification scope

Automated database tests cover starter idempotency under concurrency, leader/member/viewer/outsider permissions, cross-project evidence and item isolation, existing project-link fallback, owner confirmations, stale edit conflicts, optional items, owner deactivation, past deadlines, Markdown/JSON exports and preservation of existing submission status/wiki pages. Browser checks cover deadline confirmation, pitch/wiki evidence and assignment, readiness, actual file download, read-only viewer access, and mobile layout alongside the existing workflows.

Final results: 51 automated tests passed across six files; all 15 browser regression flows passed with no uncaught errors; TypeScript and production build passed. Desktop/mobile screenshots were reviewed. Existing Mermaid bundle-size warnings remain. No lint script is configured. No new external credentials or provider delivery verification is required for this module.
