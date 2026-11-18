# DevCollab implementation status

Updated 18 October 2026. The source and local preview are implemented through the main Stage 1–4 modules. Production and external integration acceptance remain open.

## Working locally

- Stage 1: registration, real email verification token, sign-in/out, password reset, optional Google configuration; transactional workspace invitations, limited/approved join links, roles and ownership transfer. The loopback test inbox enables registration without an external sender.
- Stage 2: multiple hackathons/projects, versioned tasks and Kanban, sprints, confirmed deadlines, proposed source extraction, in-app reminders and submission state.
- Stage 3: group/project/DM conversations, durable ordered messages, retry deduplication, WebSocket hints plus REST recovery; server-approved GitHub App installation mapping, signed webhooks and bounded worker sync.
- Stage 4: private resource metadata, pasted requirements, PDF/DOCX/TXT uploads to configured S3 storage, bounded parsing, versioned Markdown/wiki/Mermaid, queued document-grounded AI with exact quote validation and explicit idempotent human approval.
- Stage 5 preparation: Vercel function/daemon packaging, CI checks, private deployment/runbook and rollback sequence. No hosted deployment or 100-client scale claim.

## Evidence

- `npm run build`: TypeScript and production Vite build pass. Mermaid adds large lazy chunks; optimization remains open.
- `npm test`: 27 tests across 4 files pass with isolated real PostgreSQL. Covers auth and role contracts, links/invites, planning conflicts/reminders, DM isolation/dedupe, wiki history, AI approval idempotency, extraction guardrails, real child-process TXT/DOCX parsing and malformed-file rejection.
- `npm run test:browser`: passes desktop/mobile flows with five account contexts, real verification fixture, join links, project/task board, pasted source, wiki persistence after navigation, and two-account chat. No uncaught browser errors.
- `npx tsx scripts/smoke-local.ts`: local live preview signup → test inbox → verification → sign-in → workspace creation passes.
- `npm audit` after replacing Mammoth DOCX parser: zero known vulnerabilities at the time checked.

## External gates still required

Real sender/domain mail delivery and Google OAuth; active Redis worker and recovery; managed S3 access and actual uploaded file flow; configured OpenAI structured response and reviewed write; actual GitHub App installation/import/webhook/revocation; protected Vercel build/deployment; backup restoration and rollback drill; 100 concurrent sockets over two instances with measured latency and queue lag. Production must stay private. Browser fixtures do not count as real teammates or external provider proof.

## Known feature gaps

Task/chat attachments, opted-in email reminders, contributor-to-task association, cross-project burndown, multi-project sorting and complete cursor pagination need more work. The OpenAPI document covers only initial request contracts. File uploads are type/size checked and parsed in a bounded process but not malware scanned. Vercel configuration is prepared but not remotely built. No external invitations have been sent.

## Completion brief — Modules 1 and 2 repair pass

Inspected existing auth/library routes, membership transactions, React navigation, schema, deployment files, and tests before editing. Preserved current workspace records; no migration or data reset was needed.

Changes: authoritative signup name validation in Better Auth middleware; session identity boundary clears private query records and disconnects sockets on account change; failed logout stays on screen with a retryable error. The invitation page now previews the actual workspace, role, expiry and approval policy. Email-bound preview requires the intended verified account. An encrypted, one-hour, HTTP-only invitation intent cookie preserves the link through verification in another tab and OAuth redirects. Raw tokens are removed from the address bar and the pending cookie is cleared on successful acceptance. Local email notices explicitly distinguish test inboxes from external delivery, and the worker does not submit local-only queued messages to an unconfigured provider. Also repaired malformed package.json syntax left in the previous script edit.

Files: apps/api/src/auth.ts, app.ts, invitation-intent.ts; apps/web/src/SessionBoundary.tsx, api.ts, main.tsx, pages/Auth.tsx, pages/Workspace.tsx, pages/Collaboration.tsx, styles.css; apps/worker/src/index.ts; tests/integration.test.ts and scripts/browser-check.ts.

API verification: 30 tests passed against isolated PostgreSQL, including server signup validation, duplicate signup nonreplacement, invitation preview isolation, encrypted intent cookie and tamper rejection, plus existing auth/reset/revocation/concurrency cases. Browser verification passed all nine flows, including verification in a separate tab, named workspace/role review, reload persistence and logout/back navigation, with no uncaught browser errors. The production TypeScript/Vite build also passed. An earlier selector mismatch was fixed before this passing run.

External acceptance remains blocked on GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET with exact development and protected Vercel callbacks, and a configured transactional sender (RESEND_API_KEY plus verified EMAIL_FROM, or SMTP credentials) with a running Redis-backed worker. The application does not claim external mail or Google login has been verified. Per the completion brief, no additional feature screens are being added ahead of these Module 1–2 integration gates.

Manual check: open a new join link in another browser session, register, open the verification link in a new tab in that same browser profile, review the named workspace and role, accept, reload, then sign out and use browser Back. Email invitations require the recipient's matching verified account. Cross-device verification requires reopening the original invitation in that device's browser because the encrypted intent cookie is browser-scoped.


The browser harness cleanup explicitly closes remaining HTTP connections before stopping Socket.IO and PostgreSQL. The subsequent rerun passed all nine checks and exited successfully with code 0.

## Authentication and team audit — 20 October 2026

Added serialized duplicate-invitation and active-member checks, case-normalized email handling, explicit Continue with Google labeling and an OAuth error return preserving the destination. Provider acceptance now requires SMTP recipient confirmation or a valid Resend message ID. Added concurrent duplicate invitation and malformed/rejected provider response coverage. Configuration and external acceptance steps are in `docs/auth-team-verification.md`. Google credentials and external email credentials are absent locally; no external mail has been sent or claimed as delivered.


## Integrated team event dashboard

Preserved Better Auth, Prisma/PostgreSQL, roles, encrypted invitation outbox, join links and the existing notification worker. Added normalized invitation validation, Enter submission and scoped delivery polling. Provider success is displayed only after acceptance; local-preview, pending and failed delivery are explicit. SMTP/Resend delivery adapter is exercised with success, malformed-response and transport-failure fixtures.

Added additive event date/timezone/format/venue/participation and archive fields, plus separate project details/status/version. Workspace dashboards support multiple events, filtering, countdowns, leader edits, independent project details and recent reminders. Date conversion rejects daylight-saving ambiguity and gaps. Event reminders reuse Notification with transactional recipient/source-key deduplication. Existing submission-deadline reminders remain separate. Added restrained 3D tilt, GSAP stagger and shared entrance/hover treatment, with reduced-motion fallback.

Local additive migration and Prisma generation succeeded. Automated suite: 43 tests passed across six files. Production TypeScript/Vite build passed after normalizing the edited invitation file to UTF-8. Browser verification and final screenshot review are tracked in docs/team-dashboard.md. No external email or live Redis worker delivery is claimed. See that guide for configuration, file list and manual acceptance.

Final browser run passed all ten flows with zero uncaught errors and no 429 responses. Shared-network authenticated rate limits now use separate per-user budgets under an outer IP guard; a regression verifies exhaustion by one user does not throttle a teammate. Desktop/mobile screenshots were visually reviewed. Final build passed (existing diagram chunk-size warnings only); the repository has no separate lint configuration. Configuration and detailed results: docs/team-dashboard.md.


## Sidebar chat and sprint dashboard

Added workspace Chat and Sprints sidebar shortcuts, automatic sender-excluded unread badges, private/active-member scoping and read-cursor refresh. Project tabs and selected sprints are bookmarkable. Sprint management now includes edits, atomic bulk backlog/scope changes, one nonempty active sprint, task status/progress, original-commitment burndown, frozen completion summaries, and a cross-project workspace hub. Fixed task PATCH defaults that could clear sprint and assignee fields during status updates. Added reduced-motion/mobile navigation and stopped hidden queries from polling.

Verification: 46 automated tests across six files passed; all 12 browser flows passed with zero uncaught errors and no final-run 429 responses; TypeScript/Vite production build passed. No new migration, dependencies or provider configuration. Usage, changed-file list, limitations and screenshots: docs/sprints-and-chat.md.


## 22 October 2026 — GitHub Contributions increment

Existing GitHub scaffold extended with contributor summaries, PR state filters, 25-row activity pages, explicit missing-configuration states, disconnect confirmation and reconnect replacement. Shared violet dashboard depth/hover styles include reduced-motion and mobile layouts.

Sync publication is atomic and checks for disconnect, archive, approval and revocation before writing. Provider rate limits have timed recovery; signed webhook delivery IDs are idempotent, and repository removal is handled. No database migration or dependency additions.

See github-setup.md for configuration and limits. This increment does not implement PR review decisions or task-to-contribution associations; live App installation/webhook/Redis acceptance still requires configured external services.


Verification: `npm test` passed 47/47 across 6 files; Chrome browser regression passed 13 flows with no uncaught errors, including Contributions fixture data, PR filtering, disconnect and mobile/reduced-motion layout. `npm run build` passed TypeScript and Vite (existing large Mermaid bundle warnings). No lint command is configured. Provider requests were stubbed; no live GitHub authorization, webhook delivery or Redis-backed import was verified.

Files changed: apps/api/src/github.ts; apps/worker/src/index.ts; apps/web/src/pages/Collaboration.tsx; new apps/web/src/pages/GitHubDashboard.tsx; apps/web/src/styles.css; tests/integration.test.ts; scripts/browser-check.ts; new docs/github-setup.md; docs/implementation-status.md. Existing environment variable names are unchanged.


## 22 October 2026 — Public GitHub and project assistant

Supersedes the earlier App-only connection and document-only AI review limitations. Public GitHub repositories can connect and sync without credentials. Private App connections can request immediate API synchronization once configured; worker dispatch remains for automatic updates. Public reads recheck visibility and never use a privileged token. Real unauthenticated GitHub example-repository metadata, commit and PR endpoints returned HTTP 200 during verification; no user repository was modified.

The project AI assistant now supports questions, follow-ups, requirement reviews and architecture workflows. Shared API/worker execution claims each run once, builds bounded project-scoped source context, validates provider output/citations/diagram restrictions and rechecks authorization before saving. Ordinary requests execute in the API without Redis. Human publication creates one shared versioned wiki page and deduplicated in-app notifications. Personal assistant history is separate from the published wiki. Deep links open the published page, and wiki lists poll for teammate updates. No source code, private chat or other workspace is retrieved.

A Unicode failure was traced to the existing Windows database's WIN1252 encoding. New local/test clusters use UTF-8. The local-only `local:unicode` tool backed up and copied all 40 existing tables to a separate UTF-8 database, verified row counts and changed local DATABASE_URL only after success. The original database remains intact. API restarted; frontend and database readiness returned HTTP 200.

Changed source: apps/api/src/github.ts, ai.ts, new ai-contracts.ts and ai-service.ts, app.ts; apps/worker/src/ai.ts; apps/web/src/pages/GitHubDashboard.tsx, AssistantPanel.tsx (new), Knowledge.tsx, Planning.tsx, styles.css; scripts/browser-check.ts, local-postgres.ts, local-unicode.ts (new); tests/integration.test.ts; package.json; .env.example; docs/github-ai-setup.md (new), github-setup.md, implementation-status.md. No dependencies or schema migrations added. Keys/model remain absent locally, so no live OpenAI generation or private GitHub authorization is claimed.


Final verification for this increment:

- `npm test`: 50/50 tests passed across 6 files, including real isolated UTF-8 PostgreSQL, authentication/authorization, public GitHub access modes, AI provider success/failure, source isolation/citations, publication/notification deduplication, concurrent claims, interrupted requests and quotas.
- `npm run test:browser`: 14 flows passed, no uncaught browser errors; covers architecture generation using a clearly identified provider fixture, diagram preview, wiki publication, a second teammate's read-only view, follow-up history, mobile layout, and prior invitations/chat/sprints.
- `npm run build`: TypeScript and Vite passed; existing Mermaid-related large-chunk warnings remain. No lint command is configured.
- `npx tsx scripts/diagram-browser-check.ts`: passed after the shared renderer fix. Mermaid root-level `htmlLabels:false` preserves Client/API/Database as visible SVG text through sanitization, with no foreignObject or uncaught errors. The fixture is development-only and not bundled into the production entry.
- Live public GitHub API metadata, commits and PR endpoints returned HTTP 200 without credentials. This is read-only connectivity evidence, not private App/webhook verification. Live OpenAI answers, private GitHub installation authorization and automated Redis dispatch remain unverified because those credentials/services are absent.

Additional changed test files: scripts/diagram-browser-check.ts, apps/web/test/diagram-fixture.tsx; README.md links the current setup. Setup guide: docs/github-ai-setup.md.


## 22 October 2026 — Taste-inspired application redesign

Reference inspected directly: https://www.tasteskill.dev/ . Adopted its self-hosted Geist typography, warm paper/ink palette, rounded monochrome actions, quiet borders and layered card direction across landing, authentication, workspace selection, membership, event/project dashboards, boards, sprints, chat, Contributions, resources, assistant, wiki, notifications and dialogs. DevCollab's logo/favicon are original code-bracket vectors. The hero's interactive workspace stack replaces the violet orbital illustration; Gather/Connect/Create change its explicitly labeled preview content. Shared GSAP route transitions animate navigation rather than data refreshes. Reduced-motion rules preserve the static interface.

Files changed: apps/web/src/main.tsx, components.tsx, styles.css, new taste-theme.css and PageMotion.tsx, pages/Landing.tsx and SprintDashboard.tsx; apps/web/public/favicon.svg; apps/web/index.html; package.json/package-lock.json for @fontsource/geist; scripts/browser-check.ts; new docs/visual-system.md. No server routes, database schema, permissions, provider settings or project content changed.

See docs/visual-system.md for typography, token and motion details. Existing violet declarations were neutralized so individual modules no longer retain the old palette beneath the shared theme.


Redesign validation: production build and TypeScript passed; all 14 browser regression flows passed with no uncaught errors. Browser assertions verify Geist and the paper canvas, shared workspace styling, mobile bounds and reduced motion, plus existing functional flows. Screenshots refreshed in test-results/. No backend behavior changed and no backend test rerun is claimed for this styling pass. Existing Mermaid large-chunk warnings remain; there is no configured lint command.


## Chat palette and 3D team-card correction

Removed backgrounds from the outer chat-message containers, leaving sender/time metadata legible on the chat canvas. Soft white incoming bubbles and forest-green outgoing bubbles now use consistent rounded corners, padding, borders and shadows; conversation list/composer share a restrained sage palette. Contrast calculations: outgoing 8.66:1, incoming 11.31:1, timestamps 4.53:1.

Replaced the faint welcome-art wireframe with TeamSculpture, an original code-native layered team icon with extrusion, shadows and a floating animation. Responsive layout keeps the sculpture visible on mobile; reduced motion uses a static pose. Changed components.tsx, pages/Workspace.tsx and taste-theme.css. No backend or membership/chat behavior changed. Production build/TypeScript passed; all 14 browser regression flows passed with no uncaught errors, including chat, mobile bounds and reduced motion.

Final chat/team-card verification: all 14 browser flows passed, with no uncaught errors or mobile horizontal overflow.


## Submission readiness — first requested improvement module

Added a project-scoped SubmissionItem model and additive migration 202610220001_submission_readiness. Existing project links, confirmed deadlines, wiki pages, roles and submission status are reused. Leaders manage an editable deliverables checklist; assigned active non-viewer teammates confirm their own items; viewers can read/export. Readiness derives missing owners, evidence, confirmation and deadlines on the server. Repository/demo links fall back to existing project settings; pitch links and project-local architecture pages supply evidence. Optional items do not block readiness. Export downloads Markdown/JSON snapshots and never changes submission status or sends an entry externally.

All writes use existing workspace locking and version conflicts; owner/wiki associations are scoped and foreign-keyed. Starter requests are idempotent under concurrency. A patch-default issue that blocked member confirmations and could clear notes was fixed; notes preservation is covered by the new integration regression. Browser testing also exposed an editor closure race during checkbox saves; completion updates no longer close a new deliverable form.

Changed: packages/db/schema.prisma; new migration; new apps/api/src/readiness.ts; apps/api/src/app.ts; new apps/web/src/pages/SubmissionReadiness.tsx; pages/Planning.tsx; taste-theme.css; tests/integration.test.ts; scripts/browser-check.ts; README and new docs/submission-readiness.md. No new packages, provider keys or external services. Migration applied locally without resetting existing records, and the API restarted to load it.

Final verification: npm test passed 51/51 across six files; TypeScript/Vite production build passed with the existing Mermaid bundle warning. All 15 browser regression flows passed with no uncaught errors, including actual summary download, owner confirmations, project-local wiki evidence, viewer permissions, mobile bounds and reduced motion. Desktop and mobile screenshots were reviewed. Checkbox feedback is immediate, rolls back on failure, and readiness counts update only after server confirmation. No lint script is configured. Local API readiness returned HTTP 200. No external submission or live provider delivery was attempted.

The remaining requested modules are task-to-GitHub traceability and AI source navigation/context selection/evaluations. They are kept separate from this first module and are not claimed complete.


## Task-to-GitHub traceability — second requested improvement module

Added explicit project-repository PR links to task details, with requirement text and an optional project-local wiki source. PR review/merge snapshots and a chronological task/requirement/link/sync/delivery timeline reuse the existing task history. Members can manage links/requirements; only workspace owners/admins can configure automatic completion. Viewers read only. Canonical GitHub URLs, imported PRs, scoped wiki pages, task versions and workspace locking are enforced on the server.

Automatic completion defaults off. On a successful sync, an opted-in task completes only when all current linked PRs are merged in the current repository connection. Completed sprints and historical links cannot qualify. Failed review fetches do not publish partial snapshots. Replaced repositories preserve task evidence as historical links. A task-field reload prompt preserves drafts after traceability increments the task version. No existing task, sprint, invitation, wiki, AI or submission behavior was replaced.

Changed files: packages/db/schema.prisma; new packages/db/migrations/202610220002_task_traceability/migration.sql; new apps/api/src/traceability.ts and pull-review.ts; apps/api/src/github.ts and app.ts; new apps/web/src/pages/TaskTraceability.tsx; Planning.tsx; taste-theme.css; tests/integration.test.ts; new tests/pull-review.test.ts; scripts/browser-check.ts; docs/task-github-traceability.md; docs/github-ai-setup.md; README.md. No dependencies or API keys added. The additive migration was applied locally without a database reset.

Final verification: 56/56 automated tests passed across seven files; TypeScript/Vite production build passed; all 16 browser regression flows passed with no uncaught errors. Desktop/mobile traceability screenshots were reviewed. The browser selector was scoped to the requirement display because the same text is also correctly recorded in history. Existing Mermaid bundle warnings remain; no lint script is configured. Test provider fixtures are not evidence of live private GitHub or webhook delivery. AI source navigation/context selection/evaluations remains the next module.


## AI trust — third requested improvement module

Extended the existing Responses structured-output pipeline with exact excerpt citations, source markers, saved evidence metadata and links to authenticated document sections, tasks, wiki pages and dashboards. Document readers expose section navigation; direct wiki loads are no longer limited to the first list page. Source endpoints enforce the current project and membership. Added context category controls, optional specific tasks/wiki pages and selected document sections. Context options and metrics are persisted through additive migration 202610220003_ai_trust, applied locally without resetting records.

Stored end-to-end/provider latency, evidence-entry counts and exact-match ratios, marker validation and available provider input/output token usage for both success and failure. Zero citations have null validity. Quote matching does not claim factual accuracy or exhaustive citation coverage. Uncited answers are labelled unverified. Existing architecture generation, Mermaid safety, editable drafts and explicit wiki approval remain in use.

Added six synthetic evaluation cases and a credential-free fixture runner plus explicit --live mode using the same provider call/schema/instructions as the application. Fixture checks measure validator timing, not model performance, and never invent token usage. Live mode is not run automatically. OPENAI_API_KEY/LLM_MODEL are not configured in the local environment, so no live model-quality or paid usage claim is made.

Changed files and full configuration are listed in docs/ai-trust.md. No dependency or new provider added. Automated verification passed 68 tests across eight files, and the production TypeScript/Vite build passed. All six fixture evaluations passed. Final browser verification passed all 17 flows with zero uncaught errors, including context selection, exact-section navigation, citation anchors, persisted metrics, viewer access and mobile layout. Final TypeScript check passed. Desktop/mobile screenshots were reviewed; local API readiness returned HTTP 200 after restart. There is no lint script; existing Mermaid bundle warnings remain.


## 24 October 2026 local launch and OAuth completion

The frontend and API were initially stopped. Started persistent local PostgreSQL and npm run dev without changing credentials or resetting data. Frontend http://localhost:5173, API readiness and proxied capabilities returned HTTP 200. A direct Chrome check of the real local login page passed with no uncaught errors. Google remains unavailable because GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET are absent; external Google consent cannot be verified without the owner's Google Cloud configuration.

Added an authenticated /account page and Account link from the workspace chooser. Existing password users can explicitly connect the matching verified Google identity. Enabled explicit Better Auth linking with disableImplicitLinking=true, allowDifferentEmails=false and an empty trusted-provider override list; automatic email merging stays disabled. Better Auth remains responsible for code exchange, state validation and sessions. Added application error routing and actionable OAuth error messages without reflecting arbitrary provider error text. No schema migration or dependency was added.

Changed apps/api/src/auth.ts; apps/web/src/pages/Account.tsx, Auth.tsx, Workspace.tsx, main.tsx; new apps/web/src/oauth-errors.ts; tests/integration.test.ts; new tests/oauth-errors.test.ts; scripts/browser-check.ts; .env.example, README and auth-team-verification guide. Created a complete seven-page docs/DevCollab_OAuth_Integration_Guide.docx and its source content JSON. The guide covers localhost launch, Google branding/audience/test users and Web client, exact callbacks, env/restart, new users, explicit linking, invitation continuity, Vercel, troubleshooting and acceptance checks. Word rendering and page-image review were used because LibreOffice was unavailable.

Verification: all 70 automated tests across nine files passed; production TypeScript/Vite build passed; all 18 browser flows passed with no uncaught errors. OAuth tests use real Better Auth handlers and PostgreSQL with synthetic provider profiles/token responses, including new sign-up, repeated sign-in, explicit same-email link, mismatch/unverified rejection, missing state and replay rejection. They are not proof of real Google consent or token verification. Existing Mermaid bundle warnings remain; no lint script is configured. Real Google, external email and hosted Vercel acceptance remain manual provider-dependent checks.


## SMTP invitation setup audit

User selected SMTP for real invitation delivery. Current environment still has EMAIL_PROVIDER=none, DEV_INBOX=true, no configured SMTP host/auth, APP_ORIGIN=http://localhost:5173 and no Redis listener on 6379. These are external/setup blockers, not evidence of a successful send. No worker was started, no messages were externally sent and no memberships were changed. Existing queued preview invitations were not mass-replayed.

Fixed the capability label that previously marked every non-production SMTP provider as local-test. Only known local/test hosts are now labelled local-test; an external SMTP host with preview disabled is labelled smtp. Added a non-sending email:check command for preview/provider/sender/origin configuration, SMTP connection/authentication and Redis. It does not claim sender or inbox acceptance and does not process pending messages. No secrets are printed. Eight focused email mode/provider tests passed; build results recorded below. Added docs/smtp-invitations.md explaining exact environment fields, Redis/worker startup, queue review and resend after changing origin, and verified-email invitation acceptance. SMTP credentials and shared deployment URL remain required from the owner.

Changed apps/api/src/config.ts; new apps/api/src/email-mode.ts; new scripts/email-check.ts; package.json; new tests/email-mode.test.ts; new docs/smtp-invitations.md; README.md and this status guide. No schema, dependency or existing invitation token/acceptance rules changed.

SMTP audit verification: eight focused tests passed; TypeScript/Vite production build passed with the existing Mermaid chunk warning. email:check correctly reported incomplete setup and did not send email. Docker is not available on PATH here, so the local Redis compose service was not started. No live SMTP authentication, provider acceptance or recipient inbox delivery could be verified.
