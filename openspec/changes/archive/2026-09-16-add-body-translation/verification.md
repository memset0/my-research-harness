# Verification — 2026-09-09

## Cache-first production acceptance

On explicit operator authorization, the exact verified cache-first build was
deployed without rebuilding. Changed implementation files matched the snapshot
before cutover. Previous hosting and rollback were retained; SQLite and provider
configuration were preserved.

Public owner readiness and anonymous denial passed. The older97-segment candidate
no longer matched live cache keys, so current candidates were re-enumerated before
checking a fully cached34-segment body. The database remained populated. Browser
verification returned all34 cached results in one manifest response, issued zero
translation POSTs and displayed all results after924ms. Alt+T/button restoration
issued no new requests. Eight compiled assets, CSS/root tokens, rendered controls,
mobile overflow and page-error checks passed. Translation POSTs were intercepted
throughout verification, so neither the stale-candidate attempt nor the successful
check initiated inference. This timing is not a controlled comparison against the
earlier97-segment page. Deployment and rollback pointers are only in LOCAL.md.

## Cache-first concurrent-pack follow-up

Added bounded bulk SQLite reads, cache-only manifest results and concurrent
submission of remaining inference-sized packs. Fully cached bodies issue no
translation POST, and waiting for Codex readiness no longer blocks cache reads.
Per-pack failures are isolated; stale revision failures cancel siblings and clear
obsolete results. Existing two-slot Codex admission and bounded backend queuing
remain enforced. Snapshot cache hits remain usable even if another lookup evicts
their memory entries before the request resumes.

The current implementation passed57 tests across5 focused files, including bulk
chunk ordering/misses/duplicates, manifests beyond the memory entry limit,
cache-only owner API responses, all-cached UI, pending readiness, concurrent packs,
independent completion/failure, sibling cancellation and two-slot provider
admission. The first run found an ambiguous test status selector; scoping it to
the control status resolved that fixture failure. Final focused tests passed both
in the main checkout and the isolated build snapshot.

The isolated production build and type validation passed. Neutral browser checks
used pre-existing SQLite fixtures with the Codex executable deliberately disabled:
Wiki8, Report4 and Experiment19 cached segments each rendered from one manifest
response, with zero translation POSTs. Local observed display times were403ms,
219ms and131ms respectively; these are not same-environment comparisons with the
earlier public97-segment measurement. Alt+T/button restore sent no extra requests;
compiled CSS/tokens, rendered controls, mobile overflow and page-error checks
passed. No real Spark inference was used. Preview hosting was stopped after
verification; the production deployment was not changed in this follow-up.

## Authorized deployment and live cache observation

The operator subsequently requested deployment before further cache-flow changes.
An isolated release based on the previously deployed translation cache version
received only the concurrency/control changes and their documentation/fixtures.
Production build and its type validation passed. No additional unit suite was run.
The public rendered controls, English copy, Alt+T handling, owner readiness,
anonymous denial, actual manifest, compiled CSS/tokens and responsive layout passed.
The preliminary paid POST was intercepted; no new inference test was initiated.

A live unchanged body with97/97 prevalidated SQLite entries reproduced sequential
cache delivery: five requests of24/24/24/24/1 segments, with observed request times
2010/1888/2042/1871/994ms and all translations visible after9910ms. The manifest
finished after939ms. Only requests whose exact keys were already present and
unexpired were forwarded. Returned text matched existing SQLite results; all97
access timestamps advanced, with zero expiry/write timestamp changes. Hiding and
restoring the completed body took125ms and issued no additional translation HTTP
requests, including subsequent Alt+T toggles. No page errors occurred.

This confirms cache reuse but also a fresh-page latency problem: cache hits still
traverse the sequential inference-sized request loop. Bulk cache delivery with the
manifest is a proposed follow-up, not part of this deployment. Private release,
rollback, logs and screenshot pointers are recorded in LOCAL.md. The two-slot
admission fixtures remain unexecuted; build success is not concurrency-test proof.

## Unverified follow-up: concurrency and reading controls

The source now uses a two-slot process-global admission queue around translation
and readiness Codex calls, and allows two active translation batches. English
controls share one Alt+T/button toggle, retaining completed results while hidden
for the unchanged body. Added focused fixtures for admission/cancelled waiters,
batch concurrency, and repeated button clicks without additional HTTP calls.
Per the operator's instruction, these fixtures and additional tests/typechecks,
builds, and rendered-browser checks were not run. No new paid translation tests
or deployment occurred. Earlier passing results do not validate this follow-up.

Read-only inspection of the live SQLite metadata found 117 retained translations
and 97 entries accessed more than one second after their latest write. This is
evidence of persistent cache reads, not an aggregate request hit-rate measurement.
The existing cache key includes the entire body revision, so any body change
invalidates the document's old keys. Previously, enabling the UI always fetched
the manifest and each batch again, even on cache hits; progress did not distinguish
cache reads from inference. Readiness also launches Codex without starting an
inference turn. Deployment-specific paths are recorded only in LOCAL.md.

## Integration map and provenance

- `apps/web/lib/translation/segments.ts`: pure Markdown block segmentation,
  trusted formatting tokens, bounded splitting/packing, safe reconstruction,
  and removal of generated automatic links.
- `sources.ts` and `manifest.ts`: shared source selection and revision contract;
  normalized Experiment prose, Wiki/report bodies, valid figure captions.
- `codex.ts`: local ephemeral app-server lifecycle, exact Spark/version gate,
  ChatGPT-only authentication, isolation, bounded transport and cleanup.
- `service.ts`: serialized inference, fair bounded queue, partial results,
  cache limits, and subscription-aware cancellation.
- `http.ts` and `app/api/translations/`: exact document resolution through
  existing authorized services, owner/CSRF checks, bounded requests, manifests,
  source validation before and after inference, and no-store responses.
- `components/body-translation.tsx`, shared `Markdown`, Experiment normalized
  renderers, Wiki body, report body, and visible figure captions: React-owned
  bilingual placement, original restoration, progress, retry and cleanup.

Upstream revisions and licensing observations remain in design.md. Implementation
is independent; no upstream files were copied. Concurrent Wiki registry, figure,
and membership changes were preserved rather than staged or committed by this
change. Translation does not modify project documents or verification marks.

## Codex feasibility gate

The installed `codex-cli 0.153.4` generated protocol/configuration schemas and
feature listing were inspected before integration. Account metadata reported
ChatGPT authentication and paginated model discovery included the exact
`gpt-5.3-codex-spark` model. No authentication token was inspected or recorded.

An isolated neutral Responses capture verified **`tools: []`** using empty
thread/turn environments and disabled feature, skill, orchestrator, MCP and app
discovery. A real neutral translation then completed successfully. The wrapper
itself also returned a valid JSON translation for a neutral experiment sentence.
Other CLI versions deliberately fail closed until independently revalidated.

Fake executable fixtures cover byte-split JSON/UTF-8, correlated final-answer
selection, ignored commentary/other threads, unsupported version, API-key login,
missing Spark, unexpected tool requests, quota failures, early process exit,
output ceiling, timeout, cancellation, temporary-directory removal, and readiness
without inference. The optional interrupt is sent as a JSON-RPC request; bounded
process-group termination remains the final cancellation boundary.

## Targeted automated checks

Passed **145 tests across 12 files** (20.44 seconds):

```sh
pnpm --filter @memon/web test --maxWorkers=2 --minWorkers=1 \
  lib/translation \
  components/body-translation.test.tsx \
  app/api/translations/body/route.test.ts \
  components/markdown.test.tsx \
  components/wiki-shell.test.tsx \
  components/inbox-shell.test.tsx \
  components/experiment-managed-section.test.tsx \
  components/experiment-results-table.test.tsx \
  components/wiki-components/markdown-wiring.test.tsx \
  lib/auth/route-classes.test.ts \
  lib/server/api-route-manifest.test.ts
pnpm --filter @memon/web typecheck
openspec validate add-body-translation --strict
```

Coverage includes matching server/client identities, nested list/table/heading
placement, reference links, code/math/numeric protection, malicious HTML and new
explicit/automatic links, duplicate/missing/out-of-order output, safe long-prose
splitting, count/UTF-8 ceilings, caption/body eligibility, queue overload,
transient versus terminal retries, shared cancellation, cache TTL/entry/byte
eviction, exact identity namespaces, stale/forged input, disabled configuration,
anonymous/viewer denial, same-origin checks, late results after refresh, and
generated-outline/anchor preservation.

The initial Web typecheck exposed stale generated Core/Backend declarations;
rebuilding those existing packages resolved them. No unrelated source fix or
full repository test suite was used. All translation tests use neutral fixtures.

## Production-build browser verification

An independently configured fixture instance used a separate source tree,
dependencies, and successful production Web build. Chromium checked all three
surfaces at **1440 × 1100** and **390 × 844**, using actual local Spark inference:

| Surface | Final completed segments | Page errors | Mobile horizontal overflow |
| --- | ---: | ---: | --- |
| Wiki | 8 / 8 | 0 | None |
| Markdown report | 4 / 4 | 0 | None |
| Experiment including normalized prose | 19 / 19 | 0 | None |

Original-mode restoration removed all translation nodes. Chrome and generated
outlines contained no translation nodes. Rendered translations had a real 2px
left border, block display, resolved foreground color and defined root theme
tokens. Anonymous requests, including a forged role header, returned 401.
Desktop/mobile screenshots and rendered HTML were inspected, not merely HTTP
status codes. Report-outline markup contamination discovered during screenshot
review was fixed using non-text AST marker nodes, regression-tested, rebuilt and
verified again in Chromium.

The first attempted preview unexpectedly shared the existing build directory
because Next's custom development entry ignored the supplied override. It was
stopped; the previous production source was rebuilt independently and recovered.
Recovery details and coordination with a separately authorized deployment are
recorded only in gitignored LOCAL.md. Final translation checks used the fully
separate production-build fixture instance. Translation was not deployed to the
operator's production instance during that initial validation phase. The separately
authorized activation below supersedes that initial handoff.

## Handoff

Configuration, version gates, limits, behavior and troubleshooting are documented
in `docs/body-translation.md`. Default remains off. The implementation stays in
the active change for acceptance; no translation commit or archive was performed.

## Authorized activation follow-up

- Replaced the Codex-home setting with an explicit native `auth.json` path.
  Validation checks its name, file type and readability without parsing tokens;
  Codex retains file-backed loading and refresh. Executables remain PATH-resolved
  commands or stable symlinks without installation realpath canonicalization.
- Added Alt+Q with one-body targeting, visible shortcut guidance, editor/dialog/
  composition/repeat exclusions, cancellation and stale-response protection.
- Passed150 focused tests across12 files, including auth-path errors and opaque
  credentials, shortcut targeting across multiple bodies and pending cancellation.
  Web typecheck passed. A separate translation-only release excludes unrelated
  pending features;42 extraction/Markdown tests passed there and its production
  build completed successfully.
- Used the exact release and the explicitly selected local auth file for real
  Spark tests on neutral fixtures:8 Wiki,4 Report and19 Experiment segments.
  Desktop/mobile Chromium checks passed for Alt+Q translate/restore, preserved
  outlines, generated CSS/root tokens and no horizontal overflow or page errors.
- Activated the authorized production runner with a retained previous release
  and documented rollback. Local owner status is ready for the exact Spark model;
  anonymous status is401. Private paths, settings and deployment evidence are
  recorded only in LOCAL.md. No research source content was submitted for tests.
- Public Chromium acceptance also passed owner-session login, enabled controls,
  shortcut visibility, desktop/mobile layout, referenced CSS/JS assets and theme
  tokens. The actual host-qualified document manifest succeeded; its subsequent
  paid POST was intercepted in the browser before reaching the server to avoid
  sending production research prose. Alt+Q restored the original reading state.

## Durable cache and keyboard regression follow-up

The operator subsequently requested persistent SQLite caching and reported that
Alt+Q did not work in their browser. A regression test reproduced lost shortcuts
when a hidden dialog existed and a body handler stopped event bubbling. The fix
uses capture-phase handling, visible-root/modal scoping and a stable listener
reading the latest toggle state. Editing-only dialogs and text inputs remain
excluded. A test-fixture persistence mock was updated to reflect real cache writes;
the final isolated-release testlist passes126 tests across8 files, including6
SQLite tests and12 reading-control tests. SQLite tests cover close/reopen without
model calls, document revision isolation, private permissions, age/count/byte
limits, malformed rows, stale memory bypass prevention, concurrent handles and
redacted storage failures.

The initial real-Spark browser pass on neutral fixtures translated31 segments
across the three document types in3 paid turns, exercised the hidden-dialog and
bubbling-handler regression, and saved validated results to SQLite. Further
restart/cutover checks then verified all31 segments were reused with zero new
paid turns after restarting the fixture server. Report/Wiki reading drawers also
translated/restored4/8 cached segments without changing the background body or
adding model calls. The final build was deployed with a retained rollback release.
Public owner readiness, private SQLite initialization, anonymous401, real
host-qualified manifest and Alt+Q with hidden-dialog/bubbling regression injection
all passed. The public paid POST was intercepted before server delivery, so no
research prose was submitted for tests. Public CSS/JS assets, root tokens, mobile
overflow and page-error checks passed. Existing tabs must reload the deployed
keyboard bundle. All private database/release/evidence paths are in LOCAL.md.
## Shortcut follow-up — 2026-09-09

Changed the shortcut from Alt+Q to Alt+T, including visible guidance, accessibility metadata, and existing test inputs. No additional tests or deployment were performed, as requested. Earlier verification below applies to the previous shortcut.
