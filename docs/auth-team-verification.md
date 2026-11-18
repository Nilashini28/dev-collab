# Authentication and team invitations

The existing React/Vite frontend uses Better Auth through the Express API and Prisma/PostgreSQL. The worker uses BullMQ/Redis and SMTP or Resend. No replacement auth provider, database migration, or unrelated module is needed.

## Configuration

Keep secrets server-side. Set `DATABASE_URL`, `BETTER_AUTH_SECRET` (at least 32 characters), `EMAIL_PAYLOAD_ENCRYPTION_KEY` (32 random bytes encoded as 64 hexadecimal characters), and `APP_ORIGIN` to the exact application origin. Production requires HTTPS and `NODE_ENV=production`.

For Google, create a web OAuth client, configure its consent screen and test users as appropriate, and set `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`. Register `http://localhost:5173/api/auth/callback/google` for local testing and `https://YOUR_PRIVATE_HOST/api/auth/callback/google` for the hosted application. Restart the API after configuration. The button becomes available when both credentials exist. Better Auth owns state, callback verification and session creation; the application does not implement a second OAuth exchange. Automatic account linking is disabled. An existing password account signs in with its original method, then uses /account → Connect Google to explicitly attach the same verified Google email. Different-email and implicit linking remain disabled.

For mail, set `DEV_INBOX=false`, `EMAIL_FROM` to a provider-approved sender, and `REDIS_URL` to a reachable Redis service. Choose one:

- `EMAIL_PROVIDER=resend` and `RESEND_API_KEY`.
- `EMAIL_PROVIDER=smtp`, `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE` (`true` for implicit TLS), and any required `SMTP_USER` / `SMTP_PASSWORD`.

Run `npm run worker` alongside the API. Ensure API and worker use the same database, encryption key and mail configuration. The development inbox does not deliver external mail. `QUEUED` means awaiting processing; `PROVIDER_ACCEPTED` requires recipient acceptance from SMTP or a successful Resend response containing a message ID. It does not prove inbox delivery. Failed attempts are retried up to five times and then shown as `FAILED`.

## External verification checklist

1. Use a provider-authorized test recipient or an inbox you control. Register a new account, confirm that the provider logs show acceptance, open the verification message, sign in, reload, then sign out. Test reset-password and confirm the old session no longer works.
2. Test Google on both registration and login pages. Cancel consent and verify the error returns to login with the intended invitation destination preserved. Try an existing password account and confirm no automatic merge occurs.
3. From an authorized workspace account, invite that test email with a selected role. Confirm provider acceptance in the board and the provider's log; separately confirm inbox receipt. Open the invitation in another browser profile, sign in with that matching verified email, review the workspace and role, accept, and reload.
4. Verify a different account cannot preview or accept the email-bound invitation. Repeat acceptance without creating another membership. Revoke an invitation and try its old link; resend and try the replaced token. Confirm duplicate invitations and invitations to active members are rejected.
5. In a separate test environment, use rejected credentials or a provider test failure to confirm the board shows failure after retries. Restore credentials and resend. Never perform failure injection against production credentials.

Real Google consent/callback and external SMTP/Resend delivery remain unverified until those services are configured. Automated provider-response tests are not evidence that an external email was sent.

## Verification results — 20 October 2026

- `npm test`: 33 tests passed across five files, using isolated PostgreSQL. Includes real Better Auth registration/verification/login/reset/logout, invitation matching and acceptance, authorization, concurrency, duplicate invitations, and provider confirmation validation.
- `npm run build`: passed TypeScript and Vite production build. Existing large diagram-chunk warnings remain.
- `npm run test:browser`: all nine checks passed, zero uncaught browser errors, exit code 0. Includes registration and verification in a separate tab, four distinct invitees joining, workspace/role review, persistence, invitation queuing, logout/back navigation and mobile layout.

The initial sandboxed tests were blocked by local connection `EACCES`; reruns with local-server access passed. Browser email checks use queued fixture messages and verification tokens, not an external mail provider.

Files changed in this audit: `apps/api/src/workspaces.ts`, `apps/web/src/pages/Auth.tsx`, `apps/worker/src/index.ts`, new `apps/worker/src/email-confirmation.ts`, `tests/integration.test.ts`, new `tests/email-confirmation.test.ts`, this guide, and `docs/implementation-status.md`. The preceding auth/session/intent-cookie repair files are listed in the implementation status document.


Complete local-to-production walkthrough: [Google OAuth Word guide](DevCollab_OAuth_Integration_Guide.docx). OAuth recovery messages and explicit linking were added on 24 October 2026; real Google credentials and consent remain a manual setup step.
