# Trustworthy project assistant

## Use the module

Open **Project → AI assistant → Choose assistant context** before asking a question. Enable only the needed categories: project details, confirmed deadline/event schedule, tasks, wiki, repository metadata and your own recent answers. Tasks/wiki use bounded recent excerpts unless you enable specific selections; an empty specific selection sends none. Up to 100 recent task/wiki choices are listed; a request includes up to 30 tasks and 10 wiki pages. Select up to five readable project documents and optionally choose up to ten sections per document. Document excerpts include only their first 1,000 characters. Disable recent answers for strict category exclusion: a previous answer can repeat source content from categories you have since disabled. Prompt text is always sent. Limits and selections are saved with each run.

Answers now include clickable [S1]-style references and a **Sources and evidence** list with saved quotes, source titles/sections, and links to current records. Document links open the exact section with a section index; task links open the task drawer; wiki links load the selected page even outside the first list page. Project/schedule and repository references link to their existing dashboards. Workspace/project authorization is enforced again when opening sources. Old source content may have changed: the original quoted excerpt is retained in the saved answer, while links show current content. Deleted/unavailable sources produce an error, not another project's content.

A new `citations` array supports answer references alongside existing requirement evidence. The server checks that every source ID is supplied, every nonempty quotation is an exact substring of its supplied excerpt, and answer markers have matching verified evidence. Invalid citations discard the answer before it becomes publishable. Exact matching measures evidence presence, **not factual correctness, complete citation coverage, or resistance to every malicious instruction**. An uncited answer is explicitly labelled unverified; zero citations have a null validity rate, never a claimed 100%. Model instructions treat documents/history/user content as untrusted data, call out conflicts and missing information, and prohibit treating a draft or event end date as a confirmed submission deadline. Human review remains necessary.

Architecture generation, safe Mermaid rendering, editable task suggestions and explicit wiki approval continue unchanged. No page is published automatically. Source evidence is personal assistant history unless the user explicitly publishes a reviewed draft; it is not automatically appended to the wiki.

## Metrics

Each new run stores end-to-end application generation latency, provider request latency, attempted/valid evidence-entry counts and their ratio, marker validation, and available provider input/output token usage. Requirement entries and explicit citation entries are each counted, even when they quote the same excerpt. Durations include processing and network time; end-to-end timing begins after the run is claimed, and excludes queue waiting, browser rendering and the final save. Failed responses also retain available metrics. Missing token usage is displayed as unavailable. No estimated token counts, monetary prices, or model-quality scores are fabricated. Existing runs without metrics remain readable.

## Repeatable evaluation

`tests/fixtures/ai-evaluation.json` has six synthetic cases: correct grounded feature, missing deadline, misleading document instruction, conflicting source, fabricated quote, and unavailable other-workspace citation. Unit tests exercise the evidence validator. PostgreSQL integration tests separately check actual scoped queries, excluded content/history, cross-project section/task/wiki selection, private run ownership, direct-source authorization, and persistence of success/failure metrics. Browser checks test selection, citation navigation and visible metrics alongside existing workflows.

Run without credentials or network calls:

```powershell
npm run eval:ai
```

This uses fixed candidate answers and reports **fixture validation latency**, not model latency or model quality. Expected invalid citations are successful rejection tests. Token usage is null. The local JSON report is written to ignored `test-results/ai-evaluation.json`.

After configuring the existing server `OPENAI_API_KEY` and `LLM_MODEL`, explicitly run:

```powershell
npm run eval:ai -- --live
```

This makes six paid provider requests using the same provider function, instructions and schema as the application, with synthetic sources only. It reports actual latency, available input/output tokens, exact citation validity and simple keyword checks. Missing usage remains null and coverage is counted. The report includes candidate answers for human review. Keyword failures are diagnostic, and passing them does not prove correctness, robust injection resistance or workspace isolation. Review all answers, especially conflicting/missing information. Application authorization is tested with the real database suite, not claimed from synthetic prompts. Live mode requires explicit invocation and is not part of normal tests. It does not create tasks, publish wiki pages or upload the dataset to an evaluation service.

## Setup and changed files

No new provider/dependency. Keep API credentials in server environment settings, never `VITE_` values. Apply `npm run db:generate` and `npm run db:migrate`, then restart API/worker. Additive migration `202610220003_ai_trust` adds JSON context options and metrics to AiRun, preserving existing runs. API generation still runs inline without Redis; the existing worker can process queued runs using the same service.

Changed: packages/db/schema.prisma and the additive migration; apps/api/src/ai.ts, ai-service.ts, ai-contracts.ts, knowledge.ts; new ai-provider.ts and ai-evidence.ts; apps/web/src/pages/AssistantPanel.tsx, Knowledge.tsx, Planning.tsx, taste-theme.css; new AssistantContext.tsx and DocumentSource.tsx; tests/integration.test.ts, new tests/ai-evidence.test.ts and tests/fixtures/ai-evaluation.json; scripts/browser-check.ts, new scripts/ai-evaluation.ts; package.json and setup/status docs. No new environment variables.

Provider behavior follows [OpenAI structured outputs](https://developers.openai.com/api/docs/guides/structured-outputs) and [Responses usage fields](https://developers.openai.com/api/reference/resources/responses/methods/create). Structured output constrains shape, not factual accuracy. Existing auth, email, GitHub, submission readiness and task traceability configurations remain unchanged.


## Verification completed locally

- `npm test`: 68/68 tests passed across eight files.
- `npm run eval:ai`: 6/6 deterministic fixture cases passed; real token usage is null, and validator-only latency is clearly labelled.
- `npm run test:browser`: all 17 flows passed with zero uncaught browser errors, including context/section exclusion, clickable citation anchors, document/task navigation, saved metrics, viewer source access, mobile bounds and existing module regressions.
- `npm run build`: TypeScript and Vite passed. Final `npx tsc --noEmit` passed. Existing Mermaid bundle warnings remain; no lint script is configured.
- Desktop/mobile evidence and section-navigation screenshots were reviewed. The local migration applied successfully, the API restarted, and `/health/ready` returned HTTP 200.

Local provider configuration is absent (`OPENAI_API_KEY` and `LLM_MODEL` are not both configured). Live generation and the six paid live evaluation requests were not run. Add the existing server variables, restart the API, run `npm run eval:ai -- --live`, and review its JSON report and answers. Then ask a real project question, follow its source links, verify context exclusions, generate architecture and explicitly publish a reviewed draft to the team wiki. Fixtures do not prove live answer quality or external delivery.
