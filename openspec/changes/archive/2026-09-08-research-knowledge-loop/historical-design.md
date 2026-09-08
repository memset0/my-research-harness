# Historical design

Superseded by design.md and the accepted proposal; retained for provenance, not as active architecture.

## Context

See proposal.md for motivation and approved directions HF-01, HF-03 and HF-04. HF-02 is a separate, deferred policy decision. `wiki-system` is actively changing the shared checkout; this proposal is isolated in its own change directory. The design does not claim any of its proposed commands or review fields are implemented.

Current source anchors:
- `packages/skills/memon-drive/SKILL.md`, Interpret evidence / Replan / Routing: the loop ends at an individual Experiment and still routes cross-project notes to the Journal skill.
- `packages/skills/memon-wiki/SKILL.md`, Evidence discipline: direct Experiment writes are forbidden and handed to the writer; this is a useful ownership boundary but not a complete cross-document workflow.
- `packages/cli/src/index.ts`, Journal registration, and `commands/journal.ts`: Commander accepts `experimentId`, while the implementation reads `runId`. The existing real-CLI reproduction returns both entities for a filtered read and omits the requested association on append.
- `packages/core/src/journal/append.ts`: read-whole-file plus rename does not serialize competing appenders. An atomic replacement is not an atomic multi-writer append.
- `packages/core/src/cli/scan.ts`: normal scan reads the journal; canonical agent handoff also injects recent events.
- Experiment README serialization has a fixed frontmatter whitelist. Simply adding an unknown evidence timestamp to a real README risks dropping it on the next write.
- Wiki commit review is human-controlled and scoped to `docs/wiki/`; it is not an individual Experiment-conclusion confirmation mechanism.

## Goals / Non-Goals

**Goals**
- Make a research decision's affected writebacks part of one completed workflow, without an additional research store.
- Remove Journal knowledge-authoring and cursor maintenance rather than rename them.
- Separate documentary evidence checks, scientific author judgement, human confirmation, and document editing.
- Work through the existing mounted/local execution modes, explicit project identity, optimistic locking and pollers.
- Preserve the full historical record and make unknown/unverified states explicit.

**Non-Goals**
- Choosing a real project's scientific direction, closing its experiments, deleting checkpoints, or migrating its Reports during this design task.
- Capturing every shell command, read, token or external agent invocation. No universal agent-hook assumption and no filesystem watcher.
- Automatically proving a scientific conclusion or rerunning an experiment when recording an evidence check.
- Replacing wiki commit review, reviving deprecated commit marks, or changing conflict precedence before HF-02 is revisited.
- A new graph database, mandatory new Experiment H2, another managed YAML file, or a rewritten historical Journal.

## Decisions

### D1. Roadmap is dedicated living wiki content, not another registry

Use the statusless wiki `roadmap` kind for the research tree and `decision`
pages for adopted changes. Reuse stable E/W identifiers and ordinary Markdown
for questions, roles, dependencies, successors, remaining evidence gates, and
reusable negative results. The kind adds no separate store or lifecycle enum:
its content determines the tree shape, and relevant node state belongs in
prose. Inline evidence is many-to-many rather than one Experiment per node.
The coordinator follows both outgoing references and backlinks and also
searches related artifact references; backlinks alone cannot find an uncited
but semantically affected experiment.

For each changed decision the coordinator produces a bounded affected-artifact list with an outcome per item: updated, inspected-and-unchanged with reason, or blocked by an actual conflict. It updates Wiki through the wiki skill and Experiments through the existing writer. A changed current description, supersession pointer, scope or interpretation is in scope without repeated per-file confirmation once the underlying decision is approved. New research choices, lifecycle transitions and human confirmation retain their own authority gates.

Never cascade deprecation solely because one source changed. Distinguish superseded direction, narrowed applicability, contradicted conclusion and paused work. Historical measurement and launch contracts remain unchanged; corrections name their evidence and predecessor. Cross-document changes are not advertised as an atomic filesystem transaction. Hash/mtime conflicts halt the affected write and the handoff states which artifacts remain inconsistent.

### D2. Journal records non-readonly tool invocations

Preserve `docs/journal.md` as legacy history. Store new versioned invocation entries under `.memon/activity/<invocation-id>.json`; each invocation has a separate identity, including retries and no-op calls. Diagnostic reads combine legacy and new records without interpreting old prose as verified knowledge.

An entry records local-offset start/completion times, origin, command/operation, bounded safe parameters and targets, outcome, and sanitized error code. Outcomes distinguish running, success, failure, conflict, no-op and partial completion. Never persist source bodies, secrets, full environments or absolute deployment paths. Record only observed identities; do not reconstruct historical associations from today's parent links.

The CLI/service entrypoint owns recording automatically. Non-readonly invocations remain visible even if they fail or make no change. Read/search/show/help/lint/validate, polling and read-only dry runs do not record. One outer invocation is one entry; nested helpers/SSE callbacks do not duplicate it. Arbitrary external shell/editor tool calls are not automatically intercepted.

Begin recording before executing a supported invocation and finalize on success, domain error, conflict and CLI exit. Crashed entries remain incomplete. A diagnostic-recording failure must be reported explicitly; it must not roll back an already successful research write solely to repair Journal. Existing source-level locking and rollback still protect actual research mutations.

### D3. Direct edits finalize with facts, not authored Journal prose

After editing and checking a batch of Experiment/Wiki documents, the writer invokes `memon --project-root . journal submit --files <relative-paths...>`. The CLI validates bounded managed paths, rejects unsafe/symlink-escaping paths and computes current document fingerprints. The agent never reads, creates, appends, rewrites or repairs Journal storage, and never supplies Journal prose or an invented before-state.

This is a maintenance-submission invocation, not a Git commit/push and not a research summary. Repeating it creates another invocation record without applying the document edits again. Native CLI writes already record themselves and need no extra submission; only direct document maintenance uses this boundary. Pure validation remains side-effect-free. Mounted workflows run the command on the actual host.

CLI cannot infer arbitrary external edit history. A submitted fingerprint certifies only the observed document version, not who edited it, why, scientific validity, user confirmation or historical completeness.

### D4. Remove redundant authoring surfaces and default readers

Retire `memon-append-journal`, `memon-digest-journal`, manual Journal append/digest-mark commands, manual Journal append API/UI, and digest cursor writing. Keep `memon doctor` independently callable; route needed integrity repair through ordinary coordinator/writer workflows without creating a replacement doctor skill. Route requests/decisions/questions to Wiki and factual changes to Experiment/Run documents.

`memon journal read` remains an explicit diagnostic command with bounded paging and typed `--experiment-id` / `--run-id` filters. The old run-shaped `--experiment-id` input is rejected with an actionable `--run-id` message rather than silently ignored. Tag, time and entity filters compose AND-style; compare parsed instants, not lexical offset strings. New output has events and an opaque next cursor, no active `lastDigestAt`.

Default `memon scan` drops the journal field and does not read its files. Diagnostic access is a separate command, not a habitual `--include-everything` path. Generated research handoffs cite current documents, roadmap and relevant evidence; debugging handoffs may explicitly request bounded history. Historical digests remain discoverable/readable, but managed creation/edit controls and PUT are retired. External file edits remain possible and visible; memon does not police the user's editor. Old Report selector text is preserved, not auto-executed during normal research; future report context comes from current source artifacts.

The web retains an explicit read-only Journal/History diagnostic entry rather than the normal research note entry. Journal writes are automatic across central and Backend mutations. Remove obsolete append route negotiation/client helpers; read routes remain scoped to the selected authorized project, and receipt diagnostics are owner-only because operation paths/errors may reveal additional project internals. Existing legacy read permissions must not be accidentally broadened.

### D5. Evidence checks are version-bound metadata, not an edit timestamp

Keep the four-file Experiment bundle unchanged. Store machine review records under `.memon/evidence-review/experiments/<E-id>.json` and `.memon/evidence-review/wiki/<W-id>.json`, with schema version and a CAS revision. IDs are canonical stable numeric IDs; slug moves do not move the identity. Reuse one core record/projection engine for both domains, but keep their document parsing adapters and existing wiki commit-review semantics distinct.

Every Experiment API/CLI projection exposes `evidence_checked_at: ISO|null`, `evidence_state: UNCHECKED|CURRENT|PARTIAL|STALE` and checked/total claim coverage. The timestamp is the latest successful whole-current-claim-set check, not the latest edit or most recent partial check. Preserve the historical timestamp after invalidation and display STALE/PARTIAL beside it. Empty claim sets remain UNCHECKED. Partial checks retain their own timestamps without presenting a full-experiment check. Existing records default to null/UNCHECKED; no bulk stamping from file mtime, existing statuses, migration dates or this audit.

A check binds explicit claim blocks, scope blocks, source references and revision fingerprints, and records method (`document-crosscheck`, `artifact-recompute`, `experiment-rerun`) plus evidence references and checked time. A command validates the supplied references/fingerprints; it cannot establish that a scientific assertion is true. The agent must actually perform and describe the stated check. Reading results, editing prose or passing schema lint alone is not a successful evidence check.

Fingerprint relevant normalized source content using a deterministic versioned digest, including typed identities, selected Variant parameters/metrics, accepted run/attempt membership where relevant, cited Run Result/Setup or explicit artifact digests, and the claim's declared scope. Do not use YAML schema_version, git SHA alone, mtime alone or updated_at alone as a content revision. Broad E citations conservatively bind all relevant bundle content and declared membership; narrow E/V citations bind the row and resolved evidence. Large external payloads are not scanned implicitly: missing/retrieval-required digests yield unresolved/unchecked scope. Exclude review metadata, timestamps, backlinks and Journal from fingerprints to prevent self-invalidating cycles.

For wiki sources, a newer page edit cannot clear evidence staleness. Pages with review records compare saved source fingerprints; legacy pages have unknown evidence-check coverage even if the legacy timestamp-based stale heuristic says false. No implicit transitive verification: citing a wiki page does not make it experimental evidence. Cycles produce a finite unresolved diagnostic, not a recursive verification loop.

### D6. Confirm individual conclusions against exact content

Expose conclusions in Experiment Findings/Conclusion and wiki finding Claim/Evidence/Limits using deterministic Markdown block boundaries. A block can be a paragraph or a complete list item with its children; do not try to NLP-split sentences or automatically rewrite prose into a new schema. Unknown/untracked conclusion blocks are visible as not user-verified.

Registered claims have opaque stable local keys in the sidecar and a locator (section heading path plus exact block text digest), explicit scope locators and source references. Text/heading offsets are display data, not identity. A block moved by insertion above it keeps its identity when its section/digest still resolves uniquely. Duplicates or edited locators must be reconciled explicitly and remain unverified in the meantime; never fuzzy-match a new statement to an old human confirmation. Shared Design/Limitations can be bound as scope so their changes invalidate every actually dependent claim. An unrelated claim edit does not invalidate a disjoint claim's confirmation.

Confirmation records contain who/which channel confirmed, confirmation time, the claim+scope+evidence fingerprint, and optional bounded note; revocation keeps history. Current `user_verified` is a derived boolean, with a reason (`never-confirmed`, `changed`, `source-unresolved`, `revoked`) and historical confirmation time where applicable. It is not an editable boolean in Markdown frontmatter. Evidence-check state and human confirmation are independent: a user can agree with a tentative interpretation while its evidence remains incomplete, and a well-crosschecked result can remain unconfirmed by the user.

Owner UI/CLI can confirm/revoke only the displayed exact revision and current sidecar CAS revision. Agent workflows never infer consent from general approval, Experiment RESOLVED, author status VERIFIED, or an old chat summary. An explicit user instruction confirming an already displayed, uniquely identified claim may be recorded by the agent with origin `agent-recorded-user-confirmation`, the bounded instruction and exact fingerprint; it must not be labelled direct owner interaction or cryptographic attestation. Ambiguity requires clarification. This new explicit-delegation channel does not expand agent powers to write existing wiki-review.csv marks.

Existing wiki commit review continues to say which document changes the owner reviewed. New claim confirmation says which particular assertion and scope the owner endorsed. Labels must make this distinction explicit. A wiki page's historical commit-review mark need not disappear when external evidence changes, but its current evidence/claim confirmation becomes stale/unverified. Do not add this new state into the existing trust-precedence ordering in this change (HF-02 deferred).

### D7. CLI, service, and cache interfaces

Proposed common commands:
- `memon evidence show <E-id|W-id>`: evidence coverage and claim/confirmation states.
- `memon evidence check <E-id|W-id> --manifest <file|->`: persist explicitly performed checks with expected content and metadata revisions; no automatic scientific assertion.
- `memon evidence confirm <E-id|W-id> --claim <key> --expected-fingerprint <digest> --expected-revision <revision>` and `revoke`: owner entrypoints; an agent may record an explicit exact-claim instruction with `--origin agent-recorded-user-confirmation --instruction <bounded-text>`, never routine inferred consent.
- `memon journal submit --files <relative-paths...>`: CLI-owned batch finalization; no Journal file operations or prose from agents.
- `memon journal read`: D4's debug-only query.

The resumed Journal cutover uses CLI submission and automatic existing project service entrypoints, not a second manual append/capture HTTP endpoint. Diagnostic receipt access is owner-only; legacy read scope remains unchanged. The separately tracked evidence-review design uses `GET /api/evidence/<experiment|wiki>/<id>` and POST `/check`, `/confirm`, `/revoke`, with Backend `/api/backend/v1` counterparts and an evidenceReview capability. Those evidence routes are not claimed as shipped by this Journal boundary.

Core derives current state; CLI and services share it. Poll existing artifact changes plus sidecar metadata using cluster-safe polling, cache indexes and emit relevant invalidations; no git/file hash subprocess per UI render. Project identity includes host in central cache keys. Rechecking one experiment reads only its selected sources and dependent claims, not every dataset/run payload.

### D8. Delivery, synchronization and historical preservation

Implement HF-01 and the Journal cleanup as scoped code/skill changes under this change, with evidence-review implementation after the necessary wiki surface stabilizes. Maintain the implementation tasks here; never tick another agent's wiki checklist or rewrite its live proposal. Record HF-02 as a deferred policy issue, not a fake implementation/archive task.

The confirmed resumed boundary covers CLI invocation recording, direct-maintenance submission, diagnostic reads, service recording, digest/manual-authoring retirement and matching installed skill instructions. Preserve HF-01 source writeback; do not implement HF-02 precedence changes or a replacement agent-in-the-loop. Evidence-review remains separately tracked in tasks section 3 and must not be presented as delivered by Journal work.

At apply, update shared references and bundled skills, then synchronize only the reviewed supported skill set using the existing installer on each affected project's actual host. Verify removed skill names are absent and unrelated custom skills remain. Update real project descriptions/scope only from approved roadmap decisions; no bulk migration/archival is implied by installing the harness. New runtime metadata needs no fabricated historical records and no schema-v1 YAML rewrite. If implementation discovers an incompatible on-disk migration is required, stop and use the reviewed FS migration workflow rather than quietly change FS_CONVENTION_VERSION.

Verification covers real CLI Journal filter reproduction, automatic CLI/web mutation events, direct-file finalization, concurrent writes/idempotency, no-read-side-effect, partial evidence coverage, stale source/content/scope changes, unrelated claim preservation, exact owner confirmation and viewer rejection. UI changes require actual rendered browser checks. Release version selection, implementation/release commit separation, exact-revision deployment and post-deploy smoke follow the repository policy; these are not extra user-action boxes in tasks.md.

## Risks / Trade-offs

- Journal becomes a developer-facing diagnostic view, not a replacement for git or research documents. Historical free text may lack typed associations; return unknown rather than repair by guess.
- Direct-file capture is explicit and bounded, not universal interception. It adds one machine finalization step but removes routine journal reading, prose append and digest cycles.
- Block-based claim identity is intentionally conservative. Rewording can require re-confirmation; fuzzy identity would silently transfer consent to changed claims.
- Reusing one sidecar engine avoids unknown Experiment frontmatter loss and YAML migrations, but requires explicit backup/version-control treatment of `.memon/evidence-review` and `.memon/activity`. They are durable project metadata, not deletable caches.
- Existing wiki review uses the word VERIFIED for document review; the new UI must say user-confirmed conclusion vs document reviewed vs evidence checked. A single green badge would recreate the ambiguity.
- Claim/scoped source fingerprints are more work than timestamps, but timestamps alone cannot satisfy HF-04. Broad source bindings may invalidate conservatively; narrowing requires explicit source selection, not silent relaxation.
- Owner credentials alone cannot prove an OS process was operated by a human. Skill prohibitions and explicit owner confirmation affordances are the stated trust boundary; no invented cryptographic human-attestation claim.
- Breaking authoring command removals require exact-version skill/runtime rollout. Preserve old files and error clearly on old invocations rather than leave silent compatibility writers.
