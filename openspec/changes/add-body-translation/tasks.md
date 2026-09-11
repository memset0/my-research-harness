## 1. Feasibility and integration boundaries

- [x] 1.1 Re-read canonical specs, active changes, current renderer/config/auth code, and upstream revision notes; deliver an integration map that preserves existing uncommitted work and records independent implementation versus any explicitly authorized licensed reuse.
- [x] 1.2 Prove the configured Codex version supports ChatGPT account detection, the exact Spark model, ephemeral sessions, enforced tool/instruction isolation, and cancellation; verify with protocol fixtures plus a neutral local smoke test, record the exact tested version and safe outcome, and pause for a revised plan if the isolation gate fails.

## 2. Body segmentation and formatting

- [x] 2.1 Implement a shared typed body manifest and block/inline segmenter; verify deterministic SSR/client IDs, nested lists, headings, tables, adjacent inline text, duplicate avoidance, Unicode, and exclusion of metadata, outlines, code, math, identifiers, controls, and generated translations.
- [x] 2.2 Implement trusted inline templates, protected placeholders, and safe result reconstruction; verify links retain their original destinations, code/math remain exact, emphasis survives, and malicious HTML, duplicate/missing markers, invalid nesting, and forged URLs are rejected.
- [x] 2.3 Add explicit experiment normalized-prose and wiki component caption adapters alongside Markdown report extraction; verify fixtures for Implementation/Investigation/Results annotations, figure captions, preserved review markers, excluded run panels, opaque components, and HTML-only no-eligible-body state.

## 3. Local Codex provider

- [x] 3.1 Add disabled-by-default local provider configuration and safe readiness reporting; verify config validation, no browser-selected command/model/path, ChatGPT-only auth, API-key override rejection, no credential disclosure, and no remote-node execution.
- [x] 3.2 Implement the Node app-server wrapper with fixed Spark selection and enforced isolation; verify split JSON/UTF-8 frames, ID correlation, final-answer filtering, completed versus failed turns, unexpected tools, early exits, unsupported versions, and bounded output using a fake child process.
- [x] 3.3 Implement timeout, interrupt, bounded process-group termination, cleanup, and redacted error mapping; verify listener/temp-resource cleanup, freed concurrency slots, quota/auth/model failure without fallback, and no automatic retry for terminal provider failures.

## 4. Authenticated batching service

- [x] 4.1 Implement manifest-backed body batch requests and owner-only status/translation route classification plus handler checks; verify anonymous/viewer denial before cache/provider use, same-origin mutation protections, exact project identity, containment, forged segment rejection, and stale-revision 409 behavior.
- [x] 4.2 Implement timed count/serialized-byte batching, safe oversized-segment splitting, response-ID validation, and fair bounded queueing; verify no per-paragraph invocation explosion, strict first-item limits, out-of-order results, partial failures, queue 429, and capped transient retries.
- [x] 4.3 Implement bounded TTL/LRU segment caching and subscription-aware in-flight deduplication; verify exact Host/project/document/revision separation, prompt/model version invalidation, byte/entry eviction, last-subscriber cancellation, and revision recheck before returning results.

## 5. Bilingual reading UI

- [x] 5.1 Compose owner-only original/bilingual controls from existing shadcn primitives without editing primitives or theme tokens; verify disabled/unavailable states, quota/transmission disclosure, progress, explicit failed-segment retry, cancellation, and no inference on page open.
- [x] 5.2 Integrate React-owned translation placement across the three document body surfaces; verify original/translation alignment, links/anchors, table/list accessibility, unchanged editors/source content/review state, and preservation of interactive embeds.
- [x] 5.3 Wire navigation, edit, refresh/SSE, original-mode, and unmount cleanup; verify obsolete results never attach to a new body, shared requests survive another subscriber leaving, and no automatic paid retranslation follows source updates.

## 6. Acceptance and documentation

- [x] 6.1 Run the change-relevant unit/route/browser testlist and Web typecheck; verify neutral fixtures cover all three body types, adversarial output, auth boundaries, lifecycle races, queue/cache limits, and provider failures without using real research data.
- [x] 6.2 Verify desktop and mobile rendered output using browser screenshots/tests, or authenticated served HTML plus compiled CSS/root-token checks when screenshots are unavailable; record evidence for translation placement and excluded chrome, not just HTTP 200.
- [x] 6.3 Add generic configuration/usage/troubleshooting documentation and any required approved attribution; verify no operator-specific paths, account identities, secrets, or research details enter tracked files, and record local-only deployment pointers in LOCAL.md only if new facts are learned.
- [x] 6.4 Align proposal/design/specs/tasks with actual implementation and run strict OpenSpec validation; report focused checks and actual Spark smoke-test outcome, leave archive pending unless separately authorized, and do not claim completion on an unsupported local provider.

## 7. Authorized activation and keyboard toggle

- [x] 7.1 Replace the home setting with a validated native auth.json path, preserve PATH executable resolution and Codex-owned refresh, and test configuration errors without reading tokens.
- [x] 7.2 Add a visible Alt+T toggle scoped to one reading body; test editor/dialog exclusions, repeated keys, cancellation and multiple bodies.
- [x] 7.3 Build an isolated translation-only release, verify neutral Spark and rendered desktop/mobile behavior, enable the private deployment, and record readiness and rollback pointers in LOCAL.md.
- [x] 7.4 Align usage documentation and artifacts, run focused checks/typecheck and strict validation, and leave archive pending.

## 8. Durable cache and shortcut regression

- [x] 8.1 Persist validated translations in bounded private SQLite storage beside the serving configuration; verify restart reuse, exact identity isolation, expiry, eviction, malformed rows and redacted failures without uncached paid fallback.
- [x] 8.2 Reproduce shortcut failures from event propagation and hidden/modal reading roots; use capture-phase visible-body selection while preserving editor exclusions and single-body toggling.
- [x] 8.3 Run focused tests and real-browser checks including SQLite reuse across restart, then deploy an isolated update with rollback and verify public controls without sending research prose for tests.
- [x] 8.4 Align artifacts/docs with durable caching and the corrected shortcut behavior; validate the active change and record private deployment facts only in LOCAL.md.

## 9. Concurrency and reading-toggle follow-up

- [x] 9.1 Enforce two active translation batches and a shared two-slot Codex gate including readiness, bounded waiting, cancellation and cleanup.
- [x] 9.2 Use English translation controls and one button/Alt+T toggle that retains completed results for unchanged bodies without repeated HTTP calls.
- [x] 9.3 Update focused fixture coverage and document cache evidence and rollout status; do not run extra tests per the operator's request.

Task 9.1's focused concurrency fixtures passed during the cache-first follow-up. The preceding deployment used production build and rendered/live-cache observations without an extra unit suite.

- [x] 9.4 Deploy the authorized isolated update with rollback, verify public English controls and Alt+T, and observe a fully cached live body without forwarding cache misses or changing cache-delivery behavior.

## 10. Cache-first concurrent packs

- [x] 10.1 Add bounded bulk SQLite cache reads and an authorized cache-only service lookup returning validated manifest cache hits without inference.
- [x] 10.2 Display manifest cache hits immediately, concurrently submit only misses, and independently handle pack progress/failure while preserving cancellation and stale-revision protection.
- [x] 10.3 Add focused cache/API/concurrency/control regression coverage, validate the change and report rollout status without paid inference tests.

The cache-first follow-up passed57 focused tests, an isolated production build/type validation and neutral browser checks. The exact verified build was subsequently deployed on explicit operator request; archive remains pending operator acceptance.

- [x] 10.4 On explicit operator request, deploy the exact verified cache-first build with preserved SQLite state and rollback; verify the public cached-body response without forwarding inference requests.
