# DevCollab GitHub and AI setup

## What works without new keys

Sign in, open a workspace project, and choose **Contributions**. Select **Public repository**, enter `owner/repository`, and connect. No GitHub login, API token, installation ID or Redis worker is required for public reads. DevCollab confirms the repository is public with GitHub and imports real metadata, commits and PRs. Manual sync runs in the authenticated API; the dashboard shows actual completion or failure. Outbound HTTPS to api.github.com must be allowed. Shared unauthenticated GitHub limits apply; reset time appears if limited. Empty repositories are supported. A public repository becoming private causes access to be revoked until you reconnect with an approved App.

Workspace owners/admins manage repository connections. Other active members can read. Connecting a repository does not transfer ownership or grant repository write access. Existing public repository URLs saved in project details do not authorize private reads.

## Enable the AI assistant

1. Create an OpenAI API project with API billing and access to a model that supports the Responses API and strict structured outputs. ChatGPT subscription access alone is not an API credential.
2. Create a server API key. Put it in the root `.env` locally, or the server's secret environment settings in hosting. Never paste it into chat, wiki, browser fields, Git, or a VITE_ variable.
3. Set:

```dotenv
OPENAI_API_KEY=replace-with-your-server-key
LLM_MODEL=replace-with-an-enabled-responses-structured-output-model-id
```

4. Restart the API (`npm run dev` locally), or redeploy the server after updating hosted environment variables. The API reads the model for each new request. If a separate worker is running, update its environment and restart it too.
5. Open project → **AI assistant**. Ask a feature question, or choose **Architecture workflow**. Open **Choose assistant context** to select categories, specific tasks/wiki pages and up to five readable documents with optional section choices. Click **Generate architecture**.
6. Review the answer, assumptions and workflow diagram. Expand **Edit before publishing** to change the title, Markdown or Mermaid. Click **Publish to team wiki**. No page is created before that explicit action.
7. Open the published page link. Another teammate can view the same page under **Team wiki**, including the diagram. Read-only teammates can view but cannot edit. Active teammates receive an in-app notification. This is not an email notification.

Ordinary questions, architecture generation and manual GitHub synchronization execute directly in the API. Redis is not required for those operations. AI requests allow up to 90 seconds for the provider; the host must permit that plus request overhead. Vercel's existing function configuration allows up to 300 seconds, subject to plan support. API and worker execution share a database claim so the same request cannot be generated twice concurrently. Interrupted claims become failed after three minutes when the assistant is reopened.

## What the assistant receives

Only the current project's metadata and hackathon schedule, up to 30 most recently updated tasks (800 description characters each), 10 most recently updated wiki excerpts (1,500 content and 500 diagram characters each), selected document excerpts (up to 10 chunks/document, 1,000 characters/chunk), connected repository metadata, and the current user's last three saved answers (2,000 answer characters each) in this project. These are defaults: category toggles, specific task/wiki selections, and document-section choices can narrow context. Recent answers can repeat previously used material, so disable history for strict exclusion. New answers show coverage counts, clickable source excerpts, latency and available token usage. See [AI trust and evaluation](ai-trust.md). Context is not a complete code or document analysis. Private messages, other workspaces, server environment secrets and repository source code are not retrieved. Do not store secrets in project content or prompts; selected content is sent to the provider.

Sources are treated as untrusted data. Requirements must include an exact matching source quote; unsupported citations are discarded. Architecture is a proposed design, with missing facts and assumptions called out. API schema validation, Mermaid restrictions, strict/sanitized SVG rendering, server-side membership checks, and a second authorization check after generation protect publication. Generated content can still contain mistakes; review it. Provider storage is disabled using `store:false`; that flag is not a guarantee about all provider retention policies.

Questions and answers are persisted in the author's project history; publishing shares a versioned wiki page. Repeated publication of the same approved draft returns the same page and does not duplicate notifications. Saving different edits after approval returns a conflict; edit the shared page using wiki versioning instead. Up to 20 requests per workspace over a rolling 24-hour period, including failed requests; one active request per user/project. The UI shows provider/key/quota errors and preserves your question on failure. A request does not report a successful answer until a validated provider response is saved.

## Private GitHub App setup

1. Create a GitHub App under GitHub Settings → Developer settings → GitHub Apps.
2. Grant read-only repository **Contents**, **Pull requests** and **Metadata** permissions. Install it only on selected team repositories.
3. Generate an App private key and create a webhook secret. Set these server-only environment values:

```dotenv
GITHUB_APP_ID=replace-with-app-id
GITHUB_PRIVATE_KEY="replace-with-PEM-private-key-with-escaped-newlines"
GITHUB_WEBHOOK_SECRET=replace-with-a-strong-random-secret
GITHUB_WORKSPACE_INSTALLATIONS_JSON={"replace-with-workspace-uuid":[123456]}
```

Use the real installation ID from the installed App and the real workspace UUID from `/w/<workspace-uuid>`. The allowlist is administrator-controlled; users cannot approve arbitrary installations. Do not put a personal access token in these variables.

4. For automatic updates, set the App webhook URL to `https://your-api-host/api/webhooks/github`; subscribe to push, pull_request, pull_request_review, installation and installation_repositories. Localhost needs a trusted HTTPS tunnel for real GitHub webhook delivery.
5. Restart API/worker or redeploy. Choose **GitHub App** in Contributions, enter the approved installation ID and `owner/repository`, then connect. Manual connect/sync runs directly through the API even without a worker. Only a selected, approved repository is accepted.
6. For webhook dispatch, hourly reconciliation, automatic rate-limit recovery, document parsing and reminders, configure `REDIS_URL`, run Redis and `npm run worker` as a persistent service. A worker does not run inside an ordinary Vercel request function. Use the existing supported worker hosting configuration or a separate persistent host.

Disconnect preserves labeled historical activity until replacement. Connecting a replacement removes old cached contribution records; it does not delete or modify the actual GitHub repository. Imports are bounded to 500 recent commits and 500 recently updated PRs per sync, with 25 rows/page. Contributor counts are not effort rankings. Repository source code is not fetched. The task traceability module fetches review summaries for explicitly linked PRs; it never infers task links. See [task traceability](task-github-traceability.md).

## Verify after adding credentials

- Public GitHub: connect your public repo, confirm READY, correct branch/source links and real activity; test manual sync. A key is not needed.
- Private GitHub: connect an approved selected repo; confirm READY. Unapproved installations must fail. Remove repository access and check REVOKED. Check GitHub's webhook delivery status for 202 and redeliver the same delivery; no duplicate records should appear.
- AI: ask a project-specific feature question, verify its evidence and context coverage, ask a follow-up, generate architecture, preview the diagram, edit and publish. Sign in as a teammate and verify wiki access/notification; a viewer must not be able to publish or edit.
- Failure: use an invalid API key in a separate test environment; the assistant must show a meaningful error and create no wiki page. Restore the key afterward.
- Existing registration/Google/email setup remains documented in auth-team-verification.md and team-dashboard.md. These credentials are separate from GitHub App and OpenAI credentials.

Tests use isolated PostgreSQL, verified test accounts and stubbed provider responses, not paid OpenAI calls. Browser-generated fixture answers are test data and do not prove live model quality. Live AI and private GitHub verification require your credentials after setup.

References: [OpenAI structured outputs](https://developers.openai.com/api/docs/guides/structured-outputs), [GitHub repository API](https://docs.github.com/en/rest/repos/repos#get-a-repository), [GitHub rate limits](https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api).


## Existing Windows local databases

New embedded databases initialize as UTF-8. If an existing Windows database reports WIN1252, AI JSON containing arrows or multilingual characters can fail. Stop the local API/worker (leave PostgreSQL running) and run `npm run local:unicode`. This local-only repair exports a snapshot into ignored `.local/`, creates a separate UTF-8 database, reapplies the existing schema, copies/verifies row counts, and changes only local `.env` DATABASE_URL after success. It preserves the original database and environment backup for rollback. Restart the API and worker. Do not share `.local/` backups: they contain private data and credentials. No database is dropped or reset. Hosted PostgreSQL should be created as UTF-8; use your provider's backup/restore tooling for hosted conversion.


## Verification completed in this workspace

50 automated tests passed across six files; 14 Chrome end-to-end flows passed with no uncaught errors; TypeScript and the production build passed (existing large Mermaid bundle warnings). A focused check of the actual shared diagram component verified visible SVG text labels after sanitization. Public GitHub metadata, commit and PR endpoints were checked live without credentials. AI generation and private App authorization were tested with provider fixtures only. No live OpenAI request, external email, private GitHub authorization or webhook delivery is claimed. No lint script exists.

To rerun: `npm test`, `npm run build`, `npm run test:browser`. With the local Vite app running, `npx tsx scripts/diagram-browser-check.ts` verifies actual SVG labels and saves test-results/diagram-labels.png.
