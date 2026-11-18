# DevCollab

DevCollab is a private collaboration workspace for hackathon teams. It brings project planning, team communication, resources, a versioned wiki, GitHub activity, and reviewed AI assistance into one application.

## Features

- Verified accounts, workspace membership, role-based access, and email invitations.
- Project planning, tasks, deadlines, and submission readiness.
- Persistent team chat and real-time updates with Socket.IO.
- Resources and a versioned wiki for team knowledge.
- GitHub repository activity and task traceability; private repositories require an approved GitHub App installation.
- AI assistance with source references and explicit review before supported task or wiki changes.

Availability of integrations depends on the credentials and services configured for the deployment. See [implementation status](docs/implementation-status.md) for current verification and limitations.

## Technology

The application uses React, Vite, TypeScript, Express, PostgreSQL and Prisma. Redis and BullMQ support background jobs; Socket.IO provides real-time communication. The repository is organized as a modular monolith:

- `apps/web/` — React frontend.
- `apps/api/` — API, authentication, authorization, and real-time server.
- `apps/worker/` — background jobs, including email and integrations.
- `packages/` — shared contracts, database schema, and migrations.
- `api/`, `infra/` — deployment entry point and infrastructure configuration.
- `scripts/`, `tests/`, `docs/` — setup and verification scripts, tests, and guides.

## Local setup

Prerequisites: Node.js 24.13 or later within major version 24, npm, and PostgreSQL. Redis is needed for background jobs and real email. Docker is optional if you supply those services yourself. On PowerShell, use `npm.cmd` instead of `npm` if the npm PowerShell script is blocked.

```sh
npm ci
npm run db:generate
npm run local:setup
```

The setup script creates a local `.env` with fresh secrets only if one does not already exist. Never commit that file. For the bundled local PostgreSQL option, start this in a separate terminal:

```sh
npm run local:db
```

Then apply migrations and run the application:

```sh
npm run db:migrate
npm run dev
```

Open <http://localhost:5173>. The development setup enables a local inbox for account verification on loopback: register, then choose **Open local test message** on the verification page. This does not send external email. Use the same localhost origin throughout sign-in and verification.

Alternatively, run PostgreSQL and Redis with `docker compose -f infra/compose.yaml up -d postgres redis`, and configure `DATABASE_URL` and `REDIS_URL` in your local environment to match. Existing `.env` files are preserved by setup, so check their values before migrating. The bundled database uses port 55432; the compose database uses port 5432.

## Configuration and real email

The local setup script creates the required development configuration. For another environment, provide `DATABASE_URL`, `REDIS_URL`, `APP_ORIGIN`, `PORT`, a random `BETTER_AUTH_SECRET` of at least 32 characters, and a separate `EMAIL_PAYLOAD_ENCRYPTION_KEY` of exactly 64 hexadecimal characters. Keep secrets on the server and out of source control.

For real invitations, configure a provider and an authorized sender, disable the development inbox, and run the worker with Redis. For SMTP the relevant keys are `EMAIL_PROVIDER=smtp`, `EMAIL_FROM`, `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, and `SMTP_PASSWORD`. Set `APP_ORIGIN` to the shared HTTPS application origin: a localhost link cannot be used by teammates on other computers. Run `npm run email:check` to check configuration, then `npm run worker` in a separate process. The checker does not send mail or prove inbox delivery.

Review queued messages before starting a worker: older messages can contain a previous origin. Revoke obsolete invitations or resend after correcting the origin. See [SMTP invitations](docs/smtp-invitations.md) for setup, queue handling, and delivery verification. A hosted installation needs access to the intended workspace database; a fresh database does not contain local workspaces.

Optional integrations require their own server-side settings and services. See [GitHub and AI setup](docs/github-ai-setup.md), [Google OAuth guide](docs/DevCollab_OAuth_Integration_Guide.docx), and [deployment preparation](docs/vercel-private-deployment.md). Do not put provider keys in frontend variables.

## Commands and verification

| Command | Purpose |
| --- | --- |
| `npm run build` | Type-check and build the web application. |
| `npm test` | Run the Vitest suite. |
| `npm run test:integration` | Run integration tests; PostgreSQL is required. |
| `npm run test:browser` | Run browser checks; see the script for prerequisites. |
| `npm run smoke:local` | Exercise the local registration, verification, sign-in and workspace flow. |
| `npm run email:check` | Check email configuration without sending messages. |
| `npm run eval:ai` | Run credential-free AI evaluation fixtures. |

## Operational limits

External email, Google OAuth, private storage, AI providers, GitHub App access, and Redis-backed jobs require separately configured services and credentials. Scanned PDFs need readable text; malware scanning is not configured. Review [implementation status](docs/implementation-status.md) and [deployment preparation](docs/vercel-private-deployment.md) before relying on a deployment.
