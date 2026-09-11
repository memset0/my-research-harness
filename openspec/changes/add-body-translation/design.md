## Context

### Cache-first concurrent submission

The body-manifest GET returns `cachedResults` alongside the unchanged revision and segment list, after owner authorization and source validation. Cache lookup is bulk, with bounded SQL parameter chunks and one transaction for expiry cleanup and access-time updates; it never starts inference. Cached results are revalidated against the exact segment and protected structure, including batches larger than the in-memory cache limit. The frontend installs all hits immediately and concurrently submits only remaining inference-sized packs. Each pack updates its own results/progress as it completes; a slow or failed pack does not hold back other packs. A stale revision clears results and aborts sibling requests. User cancellation aborts all outstanding subscriptions. The existing bounded backend queue, shared two-slot Codex admission (including readiness), identity-based deduplication and retry rules remain authoritative; HTTP request concurrency does not grant additional Codex slots.

### Authorized concurrency and reading-toggle refinement

This follow-up supersedes the initial single-invocation limit: allow two active translation batches and enforce a process-global FIFO gate around all translation-owned Codex invocations, including readiness and executable probes. Reserve at most two slots, hold them through cleanup, bound waiting to 32 invocations and the configured timeout (120 seconds by default), and remove cancelled waiters without spawning processes.

Use one main button and Alt+T to toggle original/bilingual presentation. Keep completed results in component state while hidden; re-enabling an unchanged body reuses them without HTTP or provider calls. Hiding during work cancels that subscription; unfinished work resumes only on an explicit enable/retry. Source changes, editing and unmount still invalidate retained state. Translate control disclosure, shortcut guidance and progress labels into English.

See proposal.md for motivation and scope. The shared `apps/web/components/markdown.tsx` renderer already owns artifact links, math, HTML handling, and wiki component integration. Experiment structured sections have specialized renderers consuming normalized models, so wrapping only generic Markdown would miss part of the requested body. Wiki reading surfaces separate frontmatter, diagnostics, generated outlines, and the body; report panes also support opaque HTML embeds.

Canonical specs consulted: `wiki-viewer`, `reports-store`, `report-workspace`, `structured-experiment-sections`, `auth-system`, and `central-cluster-routing`. Existing uncommitted implementation and active `wiki-figure-component`, `wiki-kind-registry`, and `experiment-owned-run-paths` work must be preserved. At apply time, reconcile integration points with their current state without absorbing their scope.

### Research record

Inspected upstream source snapshots on 2026-09-09:

| Source | Revision | Relevant files and findings |
| --- | --- | --- |
| `fishjar/kiss-translator` | `13828a8a37bb4e3b4c6a2c562bc45494dead831a` | `src/libs/translator.js`: block/inline classification, replacement versus wrapping of inline nodes, skip patterns, DOM traversal; `src/libs/batchQueue.js`: timed count/character-bounded greedy batching, concurrency, and per-item settlement; `src/apis/trans.js`: structured batch prompts and response parsing |
| `memset0/paperland` | `06aab1019d2120f2d641670aa25261883c3662fe` | `packages/backend/src/services/model_providers/codex_provider.ts`: exec and app-server modes, Codex home selection, ephemeral threads, final-answer event filtering, timeout, abort, temporary-directory cleanup |

Source repositories: https://github.com/fishjar/kiss-translator and https://github.com/memset0/paperland . Official protocol/model references: https://developers.openai.com/codex/app-server and https://developers.openai.com/codex/models . UI composition reference: https://ui.shadcn.com/llms.txt . Pin implementation attribution to reviewed revisions rather than tracking upstream HEAD implicitly.

kiss-translator carries a GPL-3.0 license file. No root license file was found in the inspected paperland snapshot, and this checkout has no root LICENSE. Direct source copying is therefore not pre-authorized by this proposal: implementation defaults to independently written adapters informed by observed behavior. Any actual vendoring first requires an explicit compatible licensing decision and required notices. Do not silently relicense memon or treat publicly readable source as permission to copy.

Official model documentation lists `gpt-5.3-codex-spark`, but local entitlement and quota are not verified by documentation. This planning phase makes no model call, reads no auth tokens, and promises no remaining quota. Readiness is a runtime check, not an inferred property of an installed CLI.

## Goals / Non-Goals

**Goals:** Share one body segmentation contract across rendering, request validation, and caching; retain React ownership and existing research semantics; make local-account execution explicit, bounded, and testable.

**Non-Goals:** A general-purpose translation proxy, browser extension, API-key provider, background project-wide translation, translated source export, agent-authored bilingual documents, or automatic rewriting of research terminology. No filesystem watchers or change to source discovery polling.

## Decisions

### 1. Scope and presentation

The initial mode is original or bilingual English → Simplified Chinese, selected per open document. Translating a document processes its eligible body, including offscreen prose, in bounded batches; opening or refreshing a document does not automatically spend quota. Switching back removes translations and cancels this view's work. The action explains local-account quota use and upstream data transmission before the owner triggers it.

Register translation roots explicitly around the wiki body, report Markdown body, and each experiment body section. Include visible natural-language descriptions from Implementation/Investigation/Results and Results annotations. Keep identifiers, statuses, parameters, numeric metrics, control labels, diagnostics, generated outlines, and member-run panels outside eligibility. Authored body headings are eligible, but generated titles and outline labels stay original and retain their anchors. Figures' visible external captions are eligible; alt attributes, embedded HTML interiors, charts, and component source YAML are not.

This deliberately does not inject into whole-page DOM or iframe documents. It preserves embedded applications and avoids translating metadata, controls, or secrets outside the intended surface. HTML-only reports with no eligible surrounding prose show a clear no-translatable-body state. Supporting iframe interiors or run documents would be a separately reviewed scope extension.

### 2. Render-aware segment extraction, not arbitrary DOM mutation

Adapt kiss-translator's block boundaries, adjacent-inline grouping, and protected inline placeholders into a typed, pure segmenter over the shared Markdown AST before artifact, outline, and review transformations. Raw HTML subtrees are excluded. The browser binds the resulting segments to React components, not `innerHTML` replacements. This is a memon-specific implementation of the upstream parsing approach, not import of the extension's whole `Translator` class and observer machinery.

Use logical leaves such as paragraphs, headings, list-item prose, table-cell prose, and captions; a parent containing eligible child blocks is not also translated. For structured experiment sections and registered components, provide explicit prose adapters using the same normalized content as their existing renderers. A shared deterministic extraction contract produces segments on the server for validation and on the client for placement. Node rendering details must not change segment boundaries between SSR and hydration.

Each segment contains a stable logical path/ID, source hash, translatable text with typed placeholders, and a trusted inline template. Preserve code/math/identifiers as atomic placeholders, and wrap emphasis/link-label text with paired formatting markers. Expose neither link destinations nor protected object contents to model reconstruction; render those from the trusted template. Validate marker identity, multiplicity, nesting, and permitted ordering before accepting a result. Escape plain output and never parse model-created HTML or arbitrary Markdown links. Preserve accessible table/list structures when placing bilingual text.

### 3. Batching and wire contract

Owner-only `GET /api/translations/status` reports enabled/readiness and safe error codes without inference. Owner-only `GET /api/translations/body` accepts document selectors plus a revision and returns the matching segment identities, hashes, and protected text for packing, never trusted template contents. Owner-only `POST /api/translations/body` accepts `{document: {host?, project, kind, id}, revision, segments: [{id, sourceHash}], targetLanguage: 'zh-CN', retry?}` for one bounded batch. The server resolves and extracts the actual body; it does not trust arbitrary client text, a custom prompt, or a requested path. The client receives segment identities/revision from the shared body manifest. Filesystem reads use existing authorized document services and containment guards. A mismatched manifest/revision returns 409 before inference and the revision is rechecked after completion. No new write occurs in project roots.

Responses carry `{revision, results: [{id, sourceHash, text}], errors: [{id, code, retryable}]}`. Completed batches render progressively; token-level UI streaming is unnecessary in v1. A server-side fixed instruction requests a JSON array of ID/text pairs and treats supplied prose as data, not instruction. Validate final model output and map by ID, never by order. Reject duplicate IDs for that segment; ignore unknown IDs as protocol errors without overwriting valid entries. Missing/empty/invalid entries fail individually. Refuse trailing arbitrary prose instead of heuristically repairing unsafe structured output.

Initial fixed safety limits: 24 segments, 12,000 UTF-8 bytes of serialized segment input plus a fixed bounded instruction prefix, 150 ms flush, two active translation batches and a shared two-invocation Codex gate per serving instance, 32 queued batches, 120-second app-server invocation timeout, 256 KiB provider-output ceiling. Executable/version probes have separate 5-second deadlines. Enforce a separate 32 KiB HTTP body ceiling before parsing. Split long Markdown prose at safe whitespace boundaries into ordered subsegments, never inside Unicode characters or protected paired groups. An indivisible over-limit segment or oversized literal heading/caption gets a visible error. Test count, serialized-byte, and oversized-single-item limits explicitly; upstream's allowance for an over-limit first item is not copied.

Malformed input is 400, unknown authorized document is 404, stale revision is 409, oversized input is 413, queue pressure is 429, unavailable provider is 503, and timeout is 504. Partial segment errors use the typed result envelope. Preserve existing owner-only 401 behavior for anonymous/viewer calls rather than inventing a new auth convention. Check owner role inside handlers as well as route classification; all translation endpoints are privileged and excluded from viewer reads. POST also uses same-origin/CSRF protections consistent with session-authenticated mutations.

### 4. Local Codex app-server wrapper

Prefer paperland's app-server pattern over its configurable `bash -c` exec path. Use Node `child_process.spawn` with an explicit argv array and stdio JSON-RPC, because memon is Node-based and this avoids arbitrary shell expansion. Serving-process environment configuration is `MEMON_TRANSLATION_ENABLED=1` (default off), `MEMON_TRANSLATION_CODEX` (default `codex`), and optional `MEMON_TRANSLATION_AUTH_JSON`. Safety limits are fixed constants in this release, not browser-selected inputs. Model is fixed to Spark for this capability. Do not add a browser-editable command or copy auth files into a project/backend. Config paths and deployment details remain in protected local configuration/LOCAL.md only.

The lifecycle is initialize → initialized → account/read and paginated model/list preflight → thread/start with ephemeral/read-only settings → turn/start → correlated final-answer item → successful turn/completed. Use request/thread/turn IDs and final-answer item phases; process split UTF-8/JSON lines with bounded buffers. Supported settings were checked against generated schemas for `codex-cli 0.153.4`; pin this exact tested version rather than assuming forward compatibility. Account metadata must indicate ChatGPT auth, not an API key, and the effective provider/model must match the request. CLI-owned refresh is retained; the wrapper never parses or logs token material. A model-list entry is only a readiness hint; actual invocation failure remains authoritative.

Run from a fresh non-project directory. Explicitly disable shell, web search, MCP/apps, skills/project instruction loading, and other tools using the supported installed-version configuration. Do not assume `approvalPolicy: never` plus read-only sandbox removes read or execution capabilities. Add a capability-isolation probe before enabling the provider and fail closed if the installed CLI cannot enforce it. Do not mutate the user's global Codex configuration. Any unexpected tool request terminates translation; this is defense in depth, not the primary tool boundary. The first implementation task proves these capabilities before UI integration; if unavailable, pause and revise the plan rather than ship an unrestricted wrapper.

The verified profile disables every non-removed feature listed by the CLI, named MCP servers/plugins, bundled skills and host skill discovery, orchestrator skill/MCP discovery, project instructions, plan/input tools, notifications, and telemetry export. Both thread and turn receive `environments: []`; developer instructions and dynamic tools are empty. A neutral local Responses capture verified an outbound `tools: []` list. A subsequent real ChatGPT-authenticated Spark smoke completed successfully; see verification.md.

On abort send turn/interrupt where available, then terminate the owned process group with a bounded grace period and forced termination fallback. Bound stderr capture, redact errors, reap processes, remove temporary directories, and unregister listeners in all exit paths. Never use dangerous sandbox bypass flags. Strip API-key/provider override environment variables; explicitly select the intended ChatGPT provider and verify effective configuration instead of blindly inheriting arbitrary provider settings.

### 5. Lifetime, deduplication, and privacy

Keep a small memory layer (30-minute TTL, 2,000 entries,16 MiB) backed by a private local SQLite translation cache beside the serving configuration. SQLite retains validated results for30 days, at most10,000 entries and64 MiB of stored key/result bytes with LRU eviction. Its filename is `memon-translations.sqlite3`; no extra deployment setting is needed. SHA-256 cache keys include full document identity, revision, segment ID/content/template hash, target language, model, prompt and extraction version. Parameterized transactions and busy timeouts protect concurrent accesses. Cache lookup always follows authorization and revision verification; loaded output is revalidated against current protected tokens. Persist valid results before acknowledging success. Do not store original prompts or credentials. Storage failures return a redacted cache error instead of silently spending quota without persistence. SQLite state survives process restarts; no external database is required.

Share in-flight work only for the exact key. Each HTTP request holds a subscription; disconnect releases it. Abort the underlying turn when its last subscriber leaves, without cancelling another view's shared request. Source changes invalidate old keys and client generation IDs reject late responses. Edits/refresh reset to original with a prompt to translate the new revision; they do not silently run a new paid job. The server checks revision again before returning results, and the client checks it before applying them.

Queue by document batch with fair progress across documents. Transient transport failures get at most one jittered backoff retry; authentication, quota, policy, and model failures get none and stop new provider work until explicit retry. Requests that exceed capacity fail promptly instead of growing memory. Do not log prose, translations, command environments, credentials, account identity, or raw provider stderr; log safe codes, durations, counts, and opaque request IDs only.

## Risks / Trade-offs

- Upstream licensing constrains direct copying → implement independent equivalents by default; resolve attribution and compatibility before any source reuse.
- Spark entitlement, quota, and protocol can differ locally → a non-inference readiness check plus explicit neutral smoke test during apply; no claim that planning proves available quota.
- Read-only sessions can still have tools → make enforced tool/config isolation the first feasibility gate; unsupported versions fail closed rather than relying on prompt instructions.
- Structured content could be omitted or extracted twice → shared manifest/adapters and fixtures covering every specialized prose surface, not only generic Markdown.
- AI can mistranslate scientific claims → retain aligned English originals, label machine translation, never change verification or source data.
- Persisted translations contain research-derived text → restrict database permissions, keep it outside source roots, bound retention/storage, and never expose it before authorization.
- HTML iframe text is outside the body contract → explicit unsupported state rather than silently manipulating embedded applications.
- Existing concurrent changes alter body renderers → re-read active artifacts and preserve those changes during apply, especially new figure captions.

## Migration Plan

### Authorized activation follow-up

The subsequent durable-cache/shortcut revision supersedes the original blanket
dialog exclusion: capture-phase handling selects only visible reading roots,
ignores hidden dialogs, and scopes a visible reading modal to its own body.
Editing-only modals and text editors remain excluded. The installed listener
uses the latest toggle state rather than reattaching a stale readiness closure
after each render. Refreshing the browser is required to load a deployed handler.

The operator now requests deployment activation. Replace `MEMON_TRANSLATION_CODEX_HOME` with `MEMON_TRANSLATION_AUTH_JSON`: require the native basename `auth.json`, validate existence without reading tokens, derive its parent as CODEX_HOME, and force file credential storage. The executable remains an uncanonicalized PATH command or symlink. Keep the tested CLI protocol gate independently of executable resolution. Alt+T dispatches to only one reading root (focused/last interacted, otherwise first), ignores editors, dialogs, composition, repeats and extra modifiers, and invokes the same translate/stop actions as buttons. Show the shortcut beside controls. Build an isolated release containing only this change and committed dependencies, preserve unrelated pending work, verify readiness and rendered output before cutover, and record private settings/rollback pointers only in LOCAL.md. This authorization supersedes the initial no-deployment scope below.

No content migration or filesystem version bump. First complete neutral protocol/isolation feasibility and targeted tests, then integrate extraction, service, and reading UI. Enable only through local configuration after proving the local serving account can invoke Spark. A neutral one-batch smoke test during apply consumes a small amount of quota and must report its actual outcome; never use private research text as a test fixture.

Follow repository release/hosting rules for the now-authorized activation. Verify UI via typecheck and rendered browser tests/screenshots, or authenticated served HTML plus compiled CSS and referenced root tokens when screenshots are unavailable. Use the change-relevant testlist, not the full repository suite. Disable configuration to roll back inference immediately; original rendering and all authoritative documents remain usable.
