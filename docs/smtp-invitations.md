# Send real workspace invitations through SMTP

The current installation uses `EMAIL_PROVIDER=none`, `DEV_INBOX=true` and `APP_ORIGIN=http://localhost:5173`. It saves messages for development; it has not sent an invitation externally. Redis is also stopped. SMTP sending and secure invitation acceptance are already implemented. A setup checker is now available with `npm run email:check`; it never sends mail or processes pending invitations.

## Configure your provider

Obtain your SMTP hostname, port, username, SMTP password and authorized sender from your email provider. This application currently uses SMTP username/password authentication (or an explicitly approved unauthenticated relay). A provider requiring OAuth-only SMTP needs separate provider-specific integration; Google web sign-in credentials do not authenticate the SMTP sender. Keep passwords in the ignored root `.env` file or hosted server secrets, never in chat or frontend variables.

Edit the existing server `.env` without replacing its database/auth/encryption secrets:

```dotenv
EMAIL_PROVIDER=smtp
DEV_INBOX=false
EMAIL_FROM="DevCollab <your-approved-sender@your-domain.com>"
SMTP_HOST=your-provider-hostname
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=your-smtp-username
SMTP_PASSWORD="your-smtp-password"
APP_ORIGIN=https://your-shared-devcollab-domain
REDIS_URL=redis://localhost:6379
```

Use the provider's actual values. For port 465 use `SMTP_SECURE=true`; port 587 generally uses `SMTP_SECURE=false` with STARTTLS. Do not disable certificate verification. The authorized sender must meet your provider's verification/domain requirements. A sandbox/test SMTP inbox does not deliver to real recipients. Verify delivery separately with a safe address you control. SMTP acceptance is not proof that an email reached the inbox; check spam, bounces and provider delivery logs.

## Make the app reachable

Teammates on other computers cannot use a localhost invitation link to reach your computer. Configure the existing Vercel deployment or another shared deployment, with the same PostgreSQL database/workspaces you intend teammates to join. A fresh hosted database will not contain your existing local workspace; migrate data deliberately with a backup or recreate the workspace on the hosted installation. Do not assume a matching name means the same workspace.

Set APP_ORIGIN to the exact shared HTTPS origin and make sure the app, API, auth cookies and invitation routes work on it. Give testers access through any private deployment protection. Update Google OAuth's callback registration if changing origins. Keep secrets identical across instances of the same deployment. The email checker rejects loopback HTTP origins for remote-team readiness; it does not independently prove external reachability. Test the shared URL on another device.

## Start the queue infrastructure

The existing email worker requires TCP-compatible Redis and the same environment/database as the API. The local compose file has a Redis-only service:

```powershell
docker compose -f infra/compose.yaml up -d redis
npm run email:check
```

Docker Desktop must be installed/running for that local command. Alternatively use your configured managed Redis URL. For a hosted installation run Redis and the worker on supported infrastructure; do not point a hosted worker at localhost on your development PC. Restart the API after changing environment variables.

## Review existing invitations before starting the worker

Previously queued messages contain the origin that existed when they were created. Changing APP_ORIGIN does not rewrite already encrypted messages. Before starting the worker, review existing queued messages/invitations. For the intended workspace revoke obsolete invitations, or use **Resend** after the origin is correct. Resend cancels the old pending delivery, rotates its token and queues a fresh link; wait the existing one-minute cooldown. Do not start a worker that will accidentally send old localhost links or unrelated test invitations. Existing queued auth emails can also be processed; review those as well.

After the setup check passes and the queue has been reviewed, run the existing worker in a separate terminal or persistent hosted process:

```powershell
npm run worker
```

The worker processes eligible QUEUED messages. It records PROVIDER_ACCEPTED only when SMTP confirms acceptance of the intended recipient and supplies a message ID. Failures are retried with a bounded retry count; the team screen exposes pending/failed states. The setup checker verifies SMTP connection/authentication only; it does not validate EMAIL_FROM acceptance or recipient deliverability.

## Invite and join the correct workspace

1. Open the intended workspace, then Team and access and Invite teammates.
2. Enter the teammate's exact email, choose the intended role and send. Wait for provider acceptance in the UI; never treat a development-preview message as delivery.
3. The recipient opens the new invitation email, signs in or registers with that same email, completes verification, reviews the workspace/role and explicitly accepts.
4. The server checks matching verified email, membership authority, expiration and invitation state. Acceptance adds the user to the original workspace ID with the invited role. It does not auto-join an arbitrary Google identity or another email.
5. Confirm the member appears in Team and access and that the recipient can open the correct shared workspace. Test a mismatched email and a reused/revoked/expired invitation; they must not grant access.

No provider credentials, public/shared application URL or recipient delivery confirmation were available during this setup pass. No invitation was externally sent or membership added by the agent. Once credentials and a reachable origin are configured, rerun `npm run email:check`, review the queue, start the worker, and use Resend for the intended existing invitation.

References: [Nodemailer SMTP configuration](https://nodemailer.com/smtp), [existing OAuth guide](DevCollab_OAuth_Integration_Guide.docx), [deployment preparation](vercel-private-deployment.md).
