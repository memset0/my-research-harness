# Design

**Implementation authorized (2026-11-08).** The owner approved trying the working feature with the defaults below.

## Context

See proposal.md for motivation and `docs/handoff/2026-11-08-discussions-v12.md` for the agreed interaction. Lists currently consume source-published catalogs. Host-qualified requests execute backend route tables; ordinary Next routes must expose the same behavior. File Agent grants already support bounded title replacements but no guarded appends.

## Goals / Non-Goals

**Goals:** one shared parser/state reducer for CLI and backend, portable append-only feedback, contained transport parity, rich single-column rendering and explicit recovery from partial resolution.

**Non-Goals:** automatic conversion of Reports into discussions, running agents in the browser, question embedding outside discussions, new databases, a discussion stale/current axis, a predefined category taxonomy, automatic remote upgrades or automatic project migrations.

## Decisions

### Discussion lifecycle and readiness

Owner-confirmed: store discussion `status: DRAFT | OPEN | CLOSED` in README frontmatter. Creation starts at DRAFT while the agent prepares the material. Explicitly changing it to OPEN makes it available for normal user discussion. CLOSED means the discussion has ended; it can retain unanswered, deferred or otherwise unresolved questions. All-questions-decided and elapsed time never drive this lifecycle automatically. Explicit reopening is possible without erasing history.

DRAFT stays out of ordinary user-facing lists, waiting-for-you results and share reads. It remains accessible to agent authoring through the CLI. Only OPEN discussions accept new owner answers; CLOSED discussions preserve readable content and history. A separate draft preview/management entry is a potential follow-up design detail, not a reason to publish unfinished work by default. Agents publish DRAFT to OPEN. Owners can close/reopen OPEN/CLOSED discussions in the browser. Extend the existing bounded replacement grant to canonical discussion README and discussions.json catalog paths; central rewrites only status under mtime/hash guards and patches catalog status/mtime. Browser controls never publish DRAFT.

Keep discussion status distinct from per-question status and from whether the browser has seen the latest content. A long-lived OPEN discussion stays OPEN; a CLOSED discussion with unfinished questions stays CLOSED. Feedback/history remains available with its parent discussion status so closing cannot falsely acknowledge or resolve any response.

### Question categories

Owner-confirmed: question categories are free-form names chosen together by the user and agent. Keep `category` on each question and optional `categories` in discussion frontmatter for display order. Render undeclared categories after declared ones. Grouping and filtering expose the chosen names directly; do not seed a fixed taxonomy, derive categories from question type/status, or require an automatic categorizer. Recategorizing a question preserves its ID and response thread. Recategorization changes display and can animate, but does not invalidate the answer.

### Source offsets and shared question model

Parse Markdown structurally, using heading and code-fence source offsets. A question belongs only to a heading whose first following block is a `question` fence; nested headings inside its body do not make it end. Retain section/fence offsets and raw section bytes for deterministic SHA-256 snapshots and minimal YAML edits. Preserve malformed questions as diagnostics and renderable error sections. The grammar remains independent from versioned display-component fences.

Question types use a discriminated schema. Choice/multi options are optional for comment-only discussion; answer selections must refer to declared options, and preference fields follow the type. Confirm preferences accept booleans; multi preferences accept option arrays. DECIDED accepts a decision compatible with the type, or a nonempty narrative decision when no options exist. Agent metadata remains the durable decision; response-derived display states are separate.

### History and revision semantics

Store response, ack and reply events together in append order, with unique event IDs and local-offset timestamps. Responses keep their exact section hash and a UTF-8-safe bounded original section copy when necessary. Prefer matching Git-history section bytes when reconstructing an old version; report incomplete/unavailable originals explicitly. Pending always enumerates unacknowledged events independently of display status.

Confirmed default: compute answer-validity hashes from title, question type, options, preference and Markdown description. Exclude category, stored status, decision and rationale, so recategorization and resolving feedback do not invalidate an answer. Retain exact raw section bytes and their separate hash for optimistic locking and historical display. Compare validity to the latest owner's response; a difference displays REVISED, otherwise pending feedback displays ANSWERED, otherwise stored status. Every ack references only responses actually captured by that agent operation. Browser animation independently compares the full visible state, including categories/status/history.

Resolve captures pending response IDs, rewrites only the requested fence under mtime/hash locking, then appends acknowledgements. These are separate durable writes: errors identify whether metadata changed and which acknowledgements remain. Retrying resolution acknowledges remaining captured responses; newly arrived responses are not implicitly acknowledged. Agent replies append without changing stored status.

### Guarded appends

Extend the existing mutation wire protocol with append and expectedSize. The Go agent uses its existing per-project writer lock and bounded replay store, verifies an existing regular file or absent target at size zero, validates one complete JSON line, and appends at most 4096 bytes. Scoped read-edit permission allows only the canonical discussion log path. Existing read-only agent settings still win. Native and SSHFS use the shared source writer lock with the same size check; do not emulate append by blind whole-file replacement.

Central authorizes response appends and bounded published-discussion status edits with the discussion edit capability and refuses unrelated writes. It validates snapshot and answer against the current question, supplies owner attribution itself, and retries explicit log-size conflicts with a bounded loop and stable event identity. Response appends never rewrite README or published catalogs. A lifecycle edit separately replaces only the status value and its catalog status/mtime, using the existing small-span replacement protocol.

### Catalogs, freshness and assets

Add discussions to the source-published catalog schema and refresh pipeline. Store portable README paths, discussion lifecycle, category/question summaries and diagnostic summaries. Browser detail resolves only catalog registrations. Lists use those registrations and read registered response logs on demand to derive current pending-owner state; they never recursively discover documents. Exact cache entries and query keys are invalidated after feedback. Missing catalog remains a repair error. Generic contained document assets supply images and component payloads using the README as context.

### Browser routes and composition

Use Lucide's MessagesSquare paired-message icon for the Discussions sidebar entry and list heading. It identifies the conversation workflow independently from Reports' FileText document icon. Keep adjacent text as the accessible label and hide the decorative icon from assistive technology.

Use `/[host]/[project]/discussions` for the Project overview and `/[host]/[project]/d/[n]` for a discussion. Normal browsing defaults to OPEN, with CLOSED history available through a lifecycle filter. Waiting-for-you includes only eligible questions in OPEN discussions. A decisions view preserves published historical decisions. DRAFT is not published into these normal reader flows. Detail uses an ordered stream of ordinary prose and question cards. Each card composes existing shadcn primitives, the shared Markdown renderer and an owner response form when the discussion is OPEN. Long descriptions use a collapsible region; DECIDED defaults folded. Overview category/status controls link to uppercase question anchors. Share viewers have no form or mutation authority; whole-Project grants allow published discussion reads.

API surfaces are `GET /api/discussions`, `GET /api/discussions/:id`, and `POST /api/discussions/:id/responses` with Project/Host identity carried by the existing conventions. Add backend handlers and Next routes, route manifest classifications, API client and query-key constructors together. Response bodies and DTOs carry raw source sections for display and comparison without client runtime imports from core.

### Persisted browser comparison and update animation

Owner-confirmed: persist the last displayed state in localStorage so later fetches can identify visible changes. Scope a versioned storage key by reader context, Host, Project and discussion ID. Keep a bounded baseline of discussion metadata, stable question IDs/content signatures and displayed event identities; browser expand/filter state can live alongside it. This is presentation state, never the authority for answers or lifecycle.

Compare the successful fetched state with the previous displayed baseline before advancing that baseline. Animate changed cards and newly appended replies locally, preserving stable component keys, scroll position, expansion and unsent form input. A first visit with no baseline initializes it without making the whole page flash. A return visit can compare persisted state against current data. Identical repeated fetches do not replay effects; failed fetches do not advance the baseline. Respect reduced-motion preferences with a static change indicator. Corrupt, unavailable or quota-limited localStorage degrades to an in-memory baseline without breaking reading or responding.

Use the existing query/fetch lifecycle; introduce no filesystem watcher or browser EventSource. Update animation is independent of question REVISED status: a new reply can animate without invalidating an answer, and a question requiring reconfirmation keeps that state after the brief animation ends.

### Compatibility and authoring

Provide a standalone handoff prompt for project agents that the owner asks to move existing Report-based discussion content into native discussions. This is an optional, per-project content workflow, separate from the filesystem marker migration. Preserve source Reports and historical evidence; do not invent native owner-response events from imported prose or convert unrelated Reports automatically.

Use the proposed handoff defaults in proposal.md, subject to owner review. Extend bundled CLI guidance so research agents know how to create question fences, inspect pending feedback, resolve and reply. The handoff requests FS12, but treating an additive feature as a new convention needs an explicit policy exception: old content remains readable; the guide refreshes ignored catalogs and changes only the tracked version marker after verification. A File Agent upgrade is independent and required only for scoped append support.

## Risks / Trade-offs

- Large question sections cannot fit in a bounded response → keep the hash, bounded original and truncation marker; Git can recover full committed originals.
- README resolution and acknowledgement are not atomic together → preserve both files, expose partial progress and allow safe retry without acknowledging unseen feedback.
- Published metadata can lag manual edits → explicit refresh publishes manual authoring; response state is read from registered logs and immediately invalidated after writes.
- Existing tests contain known unrelated failures → run an explicit discussion-related testlist and distinguish pre-existing failures from regressions.
- Central and File Agent permissions have separate deployment lifetimes → capability checks return upgrade guidance, never broaden permissions automatically.

## Migration Plan

Ship `v11-to-v12.md` with the required seven sections, executable detection/verification and marker-only rollback. Verify existing-format reads and absence of automatic marker changes. Release 12.0.0 only with the guide and all change-relevant gates passing. Deploy central by exact release revision without touching the live output. Do not run project migrations, install remote agents, or archive unrelated active changes as part of release.

## Selected defaults

The owner authorized implementation after reviewing the design and the two final defaults: browser close/reopen, and answer reconfirmation only for question/option/description changes. Include threads and a decision log; questions initially live only in discussions, without rank or NEEDS_INFO. Keep the requested v12/FS12 boundary and reviewed additive migration guide. Bound the total encoded response event to 4096 bytes, prioritizing owner text over a visibly truncated historical fallback. DRAFT has no normal reader-facing entry or browser publish action. Implementation and local preview are authorized; project data migration and archive are not.
