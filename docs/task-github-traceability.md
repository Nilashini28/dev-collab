# Task-to-GitHub traceability

Open a project, connect its repository in **Contributions**, then open a task from **Task board**. The **Delivery traceability** section records the requirement, an optional project-local wiki source, explicitly linked pull requests, and a requirement-to-delivery timeline.

## Workflow and permissions

Active non-viewer members can record requirements and add/remove PR links. Only workspace owners/admins can change the automatic completion setting. Viewers can read the evidence and timeline. Server authorization applies to every route; cross-project sources, unrelated repository URLs and other tasks' links are rejected.

Add a canonical HTTPS GitHub PR URL for the connected repository. The repository must have a successful READY sync and the PR must be imported. Repeated links are idempotent. One PR can support multiple tasks; a task supports up to 30 PR links. No branch-name, commit-message or AI inference silently links a task. Requirements are human-entered, not inferred official rules. Wiki source selectors show the first 50 project pages.

Review and merge state are stored snapshots. Linked PRs are explicitly fetched even when outside the normal 500-PR import window. The next successful sync retrieves review evidence for linked PRs (up to 500 reviews per PR). Partial review histories show UNKNOWN. Before the first review sync, UNKNOWN does not mean no review exists. Review summaries use each reviewer's latest decisive approved/change-requested/dismissed record. They do not claim branch-protection approval, passing CI or deploy readiness. Comment-only and pending reviews do not grant approval. Rate limits and provider failures preserve the last complete snapshot.

## Automatic completion

Default: **off**. A leader can enable **Complete this task after all linked PRs are merged** in **Edit requirement**. It applies on the next successful repository sync; enabling it or linking an already-merged PR does not itself complete a task. Every currently linked PR must belong to the current connection and be merged. At least one link is required. Completed sprints are excluded. Task versions, task history, audit events and the existing task-update outbox are updated together. Tasks never reopen automatically. With the policy enabled, a manually reopened task can complete again on the next qualifying sync; disable the policy when intentionally reopening work.

Disconnect/revocation blocks linking and automatic completion. Replacement removes cached PR records while preserving task links as explicitly historical snapshots. Historical links must be removed/relinked intentionally before automatic completion can qualify. Unlinking keeps the task, PR and recorded history. Merge means code integration, not verified deployment or hackathon submission.

The timeline includes task creation/updates, requirement/policy changes, explicit link/unlink events, review/merge observations and automatic completion. It displays the first 200 recorded events; the database retains history. GitHub times in the timeline are observation times, not a claim about exact merge time. Source links open GitHub or the authorized wiki page.

## Setup

No new dependencies, keys or providers. Run `npm run db:generate`, `npm run db:migrate`, and restart the API/worker for the new schema and routes. The additive migration is `202610220002_task_traceability`; existing records are retained.

Public repositories use existing manual sync without credentials. Private repositories require the existing GitHub App and workspace-approved installation. Keep app secrets on the server. Review access uses the existing pull-request read permission. Subscribe the App to `pull_request_review` as well as `pull_request` events and run the configured Redis/BullMQ worker for webhook-triggered syncs. Public mode supports manual sync without a worker; an existing running worker can also reconcile stale connections. See [GitHub setup](github-ai-setup.md). GitHub login grants no repository access.

## Verification

Database integration tests cover authorization, cross-project sources, invalid/mismatched links, duplicate prevention, stale versions, review state, opt-in multi-PR completion, provider failure rollback, completed sprint preservation, historical links and unlinking. Unit tests cover decisive review ordering, dismissed/pending reviews and conflicting reviewers. Browser checks exercise requirement editing, explicit PR linking, snapshot display, manual default, timeline and mobile bounds. Provider fixtures are test data; they do not demonstrate live private-repository or webhook delivery. After configuring an App, use a safe test repository: link an open PR, submit a review, confirm sync status, merge it, sync, and confirm only an opted-in eligible task completes. Repeat with an unmerged second PR and with automatic completion disabled.

Final local results: `npm test` passed 56/56 across seven files; `npm run test:browser` passed all 16 flows with zero uncaught errors; `npm run build` passed TypeScript and Vite. Desktop/mobile screenshots were reviewed. No lint command is configured. Existing Mermaid bundle warnings remain. Live private GitHub/review webhook delivery was not verified without provider configuration.
