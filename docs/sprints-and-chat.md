# Sidebar chat and sprint dashboard

## Usage

Inside a workspace, use Chat in the sidebar to open the team inbox, project channels and direct messages. The badge counts unread messages from other people, across accessible conversations. Project Team chat also shows that workspace unread count and opens unread conversations first. Reading the latest messages while the page is visible advances the read cursor and refreshes badges. Own messages do not count as unread. Counts refresh every five seconds, with existing Socket.IO live message updates and REST recovery. This is an in-app badge, not a desktop push notification.

Use Sprints in the workspace sidebar to see planned, active and completed sprints across projects. Plan by project opens the relevant project sprint dashboard. Project tabs and selected sprints have shareable URLs using tab=sprints&sprint=ID; older selected and active sprints remain available even outside the first page.

Owners and admins can create and edit sprint goals and planned start/end times, select backlog tasks and add them atomically, move scope back to backlog, start one nonempty sprint per project, and complete it with an explicit unfinished-work decision. Active scope changes preserve the original commitment for the chart. Members can update task status; viewers have read-only access. Existing task-board creation, assignment, comments and checklist flows remain available. Completed sprint settings/scope cannot be edited; the completion summary remains frozen even when backlog tasks change later.

The dashboard shows current task counts/progress, time until the planned end, task assignments, original-commitment burndown, and a completion snapshot. Chart values are derived from stored sprint-start task snapshots and subsequent status history, not simulated data. Chart scope excludes later-added tasks, and an exact UTC data table is available. Sprint forms interpret local wall times in the displayed browser timezone and reject ambiguous/nonexistent daylight-saving times using the existing Temporal utility. No new schema or provider is needed.

## Server guarantees

All new chat summary, sprint list/detail, edit and scope endpoints authorize active workspace/project membership. Private DM summaries require participation and active peers; archived projects are excluded. Read cursor writes recheck access under the workspace lock and remain monotonic. Sprint edits, bulk scope updates, start and completion use existing workspace/project locks, version checks and audit/outbox records. A failed bulk scope transaction changes no tasks. Completed summaries and original scope are preserved.

Task partial-update validation was corrected: creation defaults no longer apply to omitted PATCH fields. Changing status now preserves sprint, assignee, labels, priority, description and due date unless explicitly changed. A regression covers this data-loss bug.

## Configuration

Run the existing PostgreSQL/API/Vite services. Chat badges, sprint CRUD and progress do not require Google, mail, Redis or other API keys. Existing optional multi-instance Socket.IO Redis configuration remains unchanged; scheduled deadline reminders still require the existing worker. No external email or desktop notification is claimed by these changes.

## Files changed

apps/api/src/chat.ts; apps/api/src/planning.ts; packages/contracts/index.ts; apps/web/src/ChatShortcut.tsx; apps/web/src/pages/Workspace.tsx; apps/web/src/pages/Planning.tsx; apps/web/src/pages/Collaboration.tsx; apps/web/src/pages/SprintDashboard.tsx; apps/web/src/styles.css; tests/contracts.test.ts; tests/integration.test.ts; scripts/browser-check.ts; this guide; docs/implementation-status.md.

## Verification

Automated checks cover sender-excluded unread totals, DM isolation, removed members, monotonic read cursors, sprint write authorization, atomic scope rollback, empty-start rejection, edits/conflicts, status changes preserving assignment, original-scope history, frozen completion and pagination/deep-link isolation. Browser checks cover badge appearance/read clearing, workspace chat access, sprint creation/editing, backlog scope, progress, chart, completion, reload, workspace sprint hub and mobile layout. Final command results follow.


Final results: npm test passed 46 tests across six files. npm run build passed TypeScript and Vite production compilation; only existing diagram chunk-size warnings remain. npm run test:browser passed all 12 flows, exited with code 0, and reported zero uncaught browser errors. The final run had no HTTP 429 responses. Desktop and mobile sprint screenshots were reviewed, including the mobile two-column navigation, scope lists, progress and chart. No separate lint script/configuration exists in this repository. The live local readiness endpoint returned ready.

Hidden team-management lists and inactive task-board queries no longer poll; project writes invalidate relevant caches rather than unrelated chat/member queries. This preserves the existing request limit while reducing background traffic. Mobile workspace/project navigation uses two columns so all shortcuts remain available without horizontal page overflow.

Screenshots use isolated test accounts: test-results/sprint-dashboard.png, sprint-mobile.png and chat-sidebar.png. No schema migration, new dependencies, external credentials, or provider setup is required for these features.
