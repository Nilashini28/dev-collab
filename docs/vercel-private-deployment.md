# Private Vercel deployment preparation

Prepared, not deployed. The local source is not linked to a Vercel project. No production credentials have been supplied. Do not deploy before configuring protection for **all deployments including production** in the Vercel project settings. Application login protects workspace records; it does not make the landing page private. Verify an unauthenticated incognito browser cannot access the deployment at all, and confirm invited testers have access through the deployment protection layer.

## Architecture

The Vite output is served by Vercel. `api/index.ts` exports one Node HTTP server for Express, Better Auth and Socket.IO. The client uses WebSocket transport and reconnects with persisted REST history. `vercel.json` routes API, health and Socket.IO to that server. A production daemon runs the BullMQ worker from `infra/worker.Dockerfile`. PostgreSQL, TCP-compatible Redis and private S3 storage remain external managed services. Choose the same region for database, Redis, API and worker; the daemon region is currently `bom1` and must be checked against account availability.

Current Vercel documentation supports [WebSockets including Socket.IO](https://vercel.com/docs/functions/websockets) and [BullMQ container daemons](https://vercel.com/docs/daemons) in beta. WebSocket duration is bounded, so reconnect testing is a release gate. Daemons are production-only; previews require a separately operated test worker and separate test databases. This configuration has not been validated by a remote Vercel build.

## Setup sequence

1. Create/link a private repository and Vercel project; enable [deployment protection](https://vercel.com/docs/deployment-protection) for previews and production before publishing. Verify the selected plan protects production. Keep preview and production secrets separate.
2. Provision managed PostgreSQL with TLS, automated backups and point-in-time recovery. Provision Redis with TLS, persistence and eviction disabled. Use a bounded PostgreSQL connection pool appropriate to function concurrency. Redis must support BullMQ and Redis Streams, not only an HTTP REST endpoint.
3. Configure environment variables from `.env.example` in Vercel, including the daemon environment. Set NODE_ENV=production, APP_ORIGIN to the exact protected HTTPS origin, SOCKET_REDIS=true, and fresh auth/encryption secrets. Never use local development credentials.
4. Configure a transactional email sender with verified SPF/DKIM/DMARC. Set Google callback to `APP_ORIGIN/api/auth/callback/google`. Test verification, password reset and invitation links through deployment protection. Google and the callback must preserve the invitation intent.
5. Configure a least-privilege GitHub App (metadata, contents and pull requests read-only), webhook secret, and a server-approved workspace-to-installation mapping. Restrict any protection bypass exception to the signed webhook path `/api/webhooks/github`; do not bypass API or auth routes. Test actual signature checks and revocation.
6. Create a private S3 bucket with public access blocked, encryption and versioning. Limit credentials to its project prefix. Configure lifecycle cleanup for orphan uploads; do not claim malware scanning is enabled. Configure a server-side OpenAI key and supported structured-output model only when ready to incur usage.
7. Before promotion, take a database backup and apply `npm run db:migrate` once from a secure administrative runner. Do not run migrations on every function startup. Deploy to the protected project, confirm API health and daemon logs, then perform every external acceptance item below.

## Release gates

- Five real accounts, both invitation modes, verified email delivery, Google callback and session revocation.
- Task conflict, sprint completion, deadline edit and worker restart without duplicate notifications.
- Two function instances, 100 concurrent socket connections, disconnect/reconnect and membership removal. Measure latency and queue lag; no scaling claim is currently made.
- Actual GitHub import, webhook replay, changed installation access and failed/retried sync.
- PDF/DOCX/TXT storage, extraction, private downloads, unreadable PDF fallback, real cited AI response, edited approval and duplicate retry.
- Wiki history/restore and malicious Markdown/Mermaid checks. Backup restoration to a separate database and protected rollback rehearsal.

## Monitoring and rollback

Monitor `/health/ready`, function 5xx/latency, daemon restarts, PostgreSQL connection saturation and oldest QUEUED email/document/AI/reminder age. Alert on FAILED records and provider rejection; never log document content, messages, tokens or credentials. Configure alerts in the chosen account before launch.

Retain the prior Vercel production deployment and worker image. This release uses additive migrations: roll application code back first while leaving additive tables in place. Do not drop tables as an automatic rollback. If data recovery is needed, stop writers and restore an encrypted backup into a new isolated database, verify row counts and authorization tests, then switch the connection secret. Preserve evidence and the original database until reconciliation is complete. Restore rehearsal is pending hosted service access.
