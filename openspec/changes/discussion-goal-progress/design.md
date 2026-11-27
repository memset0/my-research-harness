# Design

## Context

This change builds on the active `add-discussions` change (see proposal.md, Why). Facts in the current code that shape the approach:

- **Question fence schema**: the Zod object passes through unknown top-level keys, so old CLIs keep reading new fields. The `type` enum is strict, so old CLIs flag `type: subgoal` as invalid.
- **Snapshot**: the response snapshot hashes only title, type, options, preference and description. The exact section hash is separate and is used only for write locking and history.
- **Resolve**: `resolve` edits only its own fence with a YAML round trip under `guardedSourceWrite` (mtime and hash) and the source writer lock.
- **Event log**: `responses.jsonl` lines are strict; responses carry a typed answer or a nonempty comment.
- **Catalogs and backlinks**: `discussions.json` is published by refresh and read by central lists. The wiki has a backlink resolver (`packages/core/src/wiki/summary.ts`) that maps relative links to registered bundles.

## Goals / Non-Goals

**Goals:**
- One derived progress model shared by the CLI, backend and browser.
- Report references resolved against published catalogs only.
- A guarded single-field `work` edit that reuses the resolve write path.

**Non-Goals:**
- A separate goal entity, or goals spanning several discussions.
- Owner editing of `work` in the browser.
- Wiki-page refs (Report only for now).
- Weighting units differently in progress.
- Changing the event log schema, the File Agent or authorization.

## Decisions

### Subgoal is a question type, not a new fence

`type: subgoal` keeps one parser, one ID namespace, one anchor scheme, and one response/ack/reply path. The alternative was a separate `subgoal` fence. Old parsers would treat it as prose, so it degrades more quietly, but it would duplicate section parsing and break the owner's model of a "question without the blank". The owner accepted that un-updated CLIs show an invalid-type diagnostic until `memon update`.

Validation rules:
- Subgoal rejects options, preference, decision and DECIDED.
- Response validation accepts only `comment` for subgoals.
- The answer form renders only the comment Textarea.

### Work, decider and refs stay out of the answer snapshot

`work`, `decided_by`, `refs` and `goal` are excluded from the validity snapshot, as category, status and rationale already are. Marking work DONE or adding a ref therefore never turns a question REVISED, and never makes an owner's open page 409. The exact section hash still changes, so concurrent agent edits stay guarded.

### Progress is a pure derived function in core

`deriveDiscussionProgress(questions, history)` returns these counts:
- `counted`
- `completed`
- `awaitingWork`
- `waitingOwner`
- `awaitingAgent`
- `otherUnsettled`
- `deferred`
- `dropped`

It applies the spec's partition in a fixed order:
1. DROPPED and DEFERRED are not counted.
2. Completed: `work` DONE or SKIP on a settled unit.
3. Awaiting agent: ANSWERED (pending owner feedback).
4. Waiting for owner: an eligible OPEN or REVISED non-subgoal question.
5. Awaiting work: settled with TODO or DOING.
6. Other unsettled: everything else.

Pending feedback therefore wins over awaiting work: a settled question with a new owner comment counts under awaiting agent. Invalid questions are not counted, and a separate diagnostics count shows them.

`show`, the backend detail DTO and the catalog summary all call the same function. List rows use catalog counts recomputed with live response logs, which lists already read on demand, so an owner answer moves a unit immediately.

### Reference resolution

Refresh resolves references in this order:
- **Structured refs**: `refs` entries match `^R\d{4}(#[A-Za-z0-9._-]+)?$`. They resolve through the Reports catalog by ID; Report IDs are unique per Project across categories.
- **Inline links**: relative links in descriptions and agent reply texts resolve with the wiki backlink path logic against Report bundle roots.
- **Output**: per question, `refs: [{report, anchor?, source: 'field'|'link'}]` is written to `discussions.json`.
- **Unresolved refs**: a ref field entry that does not resolve becomes a diagnostic. An unresolved inline link is ignored, because it is ordinary Markdown.

Central serves `GET /api/reports/:id/discussion-refs`. It inverts the catalog refs of OPEN and CLOSED discussions on demand and reuses the existing 30-second observation memory. The route class is `read`. It is refused for document-scoped grants, so it does not leak discussion titles.

### Work edit reuses the resolve write path

Factor the existing fence YAML round trip out of `resolveDiscussionQuestion` into a shared "set fields on one fence" helper. Both `resolve` (status, decision, rationale, decided_by, optional work) and `work` (work only) use it under the same lock, guard and catalog republish. Neither command appends acks, so `work` never acknowledges feedback.

`resolve` with no `--by` records:
- `owner` when it captures at least one pending owner response;
- `agent` otherwise.

`--by` overrides this.

### Browser composition

All UI uses stock primitives; none is forked:

- **Header**: the goal line (muted text) and a segmented bar. The bar is composed of one shadcn `Progress` per segment in a flex row, or the stock bar with stacked indicator spans in a wrapper component, with a `Tooltip` per segment. A mono summary follows: `settled 4/6 · done 2/6 · 1 waiting for you`.
- **List rows**: a compact summary line plus the existing waiting Badge.
- **Cards**: a work Badge (icon plus label), an "agent decided" outline Badge, and ref Badges (`asChild` Link, title from the Reports catalog) in the metadata row.
- **Subgoal cards**: a Target icon, and only the comment form.
- **Overview**: the ToggleGroup gains a work-state group (awaiting work / done).
- **Report page**: a compact "Referenced by" Item list.

## Risks / Trade-offs

- [Old node CLIs flag subgoals as invalid and may publish catalogs with those diagnostics] → Bundled skill guidance tells agents to `memon update` before using subgoals. Central detail always reparses the README, so the website is correct once central is upgraded. The owner accepted this trade-off instead of an FS13 bump.
- [Existing DECIDED questions show as awaiting work, which lowers apparent completion] → This is intended, because completion now means built. Agents can bulk-mark finished items with `work DONE` or `SKIP`.
- [Ref inversion scans every discussion catalog on each Report view] → Catalogs are small and already memoized for 30 s. Revisit with a per-Report index only if measured slow.
- [Segmented bar built from stock primitives may look uneven] → Verify with screenshots on desktop and at 390px before shipping (F1).

## Migration Plan

No data migration and no FS marker change. Release as a MINOR bump (CLI and skills changed). Deploy central by exact SHA; nodes pick up the CLI and skills through `memon update`. Rollback is the central blue/green rollback; new fields left in project files remain harmless to the previous release, apart from subgoal diagnostics.
