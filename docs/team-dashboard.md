# Team dashboard and invitation delivery

## Existing architecture and decisions

React/Vite and React Query use the same Express REST API, Better Auth sessions, and Prisma/PostgreSQL modular monolith. Active workspace membership is checked server-side. OWNER and ADMIN roles can manage events/projects and invitations; only owners may invite admins. Each workspace can have many hackathons; each hackathon retains its existing independent project, tasks, chat, wiki, files and submission deadline. Event start time and project submission deadline are deliberately separate.

The existing email outbox stores encrypted payloads. BullMQ/Redis dispatches SMTP or Resend requests with bounded retry and provider confirmation. Invitation tokens remain hashed, email-bound, expiring and single-use (same-account acceptance retries are idempotent). Shared join links retain their existing usage and approval rules. Better Auth account linking remains disabled.

This update adds event start/end instants, an explicit IANA timezone, online/offline format, venue and participation details; project description, repository/demo URLs, independent status and version. Existing events remain unscheduled until edited. New dashboard forms require a start time, reject invalid or ambiguous daylight-saving wall times, and convert to UTC instants. Offline events require a venue. Leaders may archive events; data is retained and archived projects are unavailable through normal project APIs. Concurrent edits use expected versions.

## Email flow

Enter one or more addresses separated by commas and press Enter or Send invitations. Client and server normalize and validate addresses. Duplicate active invitations and current members are rejected under the workspace lock. The UI waits for provider status for up to 30 seconds and shows provider acceptance only after confirmation. It distinguishes local-only development inbox, pending worker processing, retry errors and final failure. The delivery-status endpoint authorizes workspace management and exposes neither tokens nor encrypted payloads.

SMTP requires acceptance of the intended recipient and a message ID. Resend requires a successful HTTP response with a nonempty provider ID. Acceptance confirms submission to the provider, not inbox delivery. Resend requests use an idempotency key; SMTP can still duplicate mail after an ambiguous network failure, although the invitation remains single-use.

## Reminders

The existing worker calls dispatchReminders every five seconds. Event reminders use the existing Notification table, with a unique recipient/source key per event version and 24/6/1-hour threshold. Repeated or concurrent dispatches are idempotent. After downtime only the nearest eligible threshold is emitted; reminders are not sent after the event starts. Active members receive notifications; removed members and archived/cancelled/submitted events are excluded. Date changes create a new version; previously delivered notifications remain historical. Submission-deadline reminders keep their existing independent scheduling.

Notifications appear on the workspace dashboard and existing project notification panel. Mark read applies only to the signed-in user's notification. Email reminders are not enabled and the UI explicitly says so.

## Configuration and operation

Use the existing .env; keep secrets out of frontend code. No new secret variables or dependencies are needed.

- DATABASE_URL: PostgreSQL shared by API and worker.
- BETTER_AUTH_SECRET and EMAIL_PAYLOAD_ENCRYPTION_KEY: retain the existing generated values.
- APP_ORIGIN: exact origin used to open the app and construct invitation links.
- REDIS_URL: reachable Redis for BullMQ. Run npm run worker continuously for email and scheduled reminders.
- Real email: EMAIL_PROVIDER=resend, RESEND_API_KEY and provider-verified EMAIL_FROM; or EMAIL_PROVIDER=smtp with SMTP_HOST, SMTP_PORT, SMTP_SECURE, SMTP_USER and SMTP_PASSWORD as required. Set DEV_INBOX=false for external mail. Development inbox messages never count as external sends.
- Google remains optional: GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET, with APP_ORIGIN/api/auth/callback/google registered in Google Console.

Deploy the additive migration with npm run db:generate and npm run db:migrate before restarting API/worker. The local migration was applied without resetting existing records. A private hosted URL is necessary for invitations opened by teammates on different computers.

## Manual acceptance

1. Configure provider and Redis, start the worker, and invite a safe account you control. Confirm provider acceptance in the board and provider logs; separately confirm inbox receipt. Force failures only with a dedicated test provider/account and confirm retry/failure text. Resend rotates the token; duplicates do not create a second active invite.
2. Accept using the matching verified account; wrong accounts must fail. Verify existing join links, approval and capacity checks still work.
3. Create two events with different dates/timezones/formats. Edit each project's name, links and status, reload, and verify event/project isolation. Test an offline venue, a past event and daylight-saving gap/overlap input. Try the management endpoints as a viewer and a different workspace member.
4. Run the worker against a test event approaching a reminder threshold, confirm an in-app notification for each active teammate, and verify repeat dispatch does not duplicate it. Archive the event and confirm no future reminder appears.
5. Check desktop/mobile dashboard, keyboard Enter submission, focus in editors, status filtering and reduced-motion settings.

## Changed files

packages/db/schema.prisma; packages/db/migrations/202610200001_event_dashboard/migration.sql; packages/contracts/index.ts; packages/contracts/event-time.ts; apps/api/src/app.ts and planning.ts; apps/worker/src/index.ts and deliver-email.ts; apps/web/src/pages/Workspace.tsx, Planning.tsx and TeamDashboard.tsx; apps/web/src/styles.css; tests/integration.test.ts, events.test.ts and email-confirmation.test.ts; scripts/browser-check.ts; .env.example; this guide and implementation-status.md.

External email provider credentials and Redis worker execution are not available in the local configuration. Automated provider fixtures and direct scheduler tests do not verify external email delivery or an operating Redis daemon.

Events with a known end time are Upcoming, Live or Past. Events whose start has passed without an end time are labelled Started, since their completion time is unknown. Countdown values clamp to zero rather than showing negative time.

Authenticated API request budgets are per user, with a separate outer IP guard, so teammates sharing a network do not consume one small shared budget. Existing auth-specific rate limits remain in place.

## Final verification results

- npm run db:generate: passed; Prisma client regenerated.
- npm run db:migrate: passed; additive local migration applied without resetting records.
- npm test: 43 tests passed across six files, including the shared-network per-user rate-budget regression.
- npx vitest run tests/events.test.ts tests/email-confirmation.test.ts: eight focused tests passed after the Started-state/date-boundary refinement.
- npx tsc --noEmit: passed. npm run build also passed its TypeScript check and Vite production build. Existing large diagram chunk warnings remain.
- npm run test:browser: all ten checks passed, no uncaught browser errors, no HTTP 429 responses in the final run, and exit code 0. Includes registration, four join-link invitees, reload/session retention, client email validation, Enter submission, accepted/rejected provider fixtures, two event formats, project detail editing, task/wiki/chat continuity, logout/back, and mobile layout with reduced motion.
- No lint script or lint configuration is defined in this repository; no separate lint success is claimed.
- Desktop and mobile screenshots reviewed: test-results/hackathon-dashboard.png and test-results/hackathon-mobile.png. These contain isolated test accounts and fixture events, not the user's workspace data.

Live SMTP/Resend acceptance and inbox delivery, Google OAuth, and continuous Redis-worker operation remain unverified because external provider access is unavailable. All provider confirmations in automated browser tests are explicitly simulated fixtures; no external email was sent. Direct reminder dispatch tests verify persisted in-app notifications, not email delivery.
