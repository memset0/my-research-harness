## Context

Slices α–ζ shipped v3 functionality post-archive. The implementation
matches the canonical specs in spirit but diverges in four concrete
points. We made the divergence calls quickly while shipping; this design
document captures the reasoning so the resync isn't re-litigated when a
future agent reads the spec and the code in one sitting.

The current state on `main`:

- `apps/web/app/api/events/route.ts` forwards the internal
  `experiment-change` EventEmitter event to BOTH the legacy SSE topic
  `experiment-change` AND the new `run-change` topic; emits
  `experiment-doc-change` for v3 exp-doc edits separately.
- `apps/web/components/use-memon-events.tsx` switches on
  `evt.topic` and invalidates `['experiments']` (the v2 name) for run
  changes; `['experiment-docs']` for exp-doc changes.
- `lib/runtime.ts`'s `recomputeAnomalies(project)` emits an `anomaly`
  event with `{ project, count }`; nothing tracks per-anomaly diffs.
- `packages/core/src/readme/warnings.ts` parses both 6-col and 7-col
  GFM tables; back-compat reads default `run: null`; writes always
  emit 7-col.

The canonical specs say:

- `live-updates`: v3 should rename v2's `experiment-change` (run edits)
  to `run-change`; reuse the name `experiment-change` for exp-doc
  events; map `run-change → ['runs']` in the invalidator.
- `experiment-readme`: 6-col tables should fail parse with
  `WARNINGS_TABLE_HEADER_MISMATCH` and the section's writes should
  refuse.
- (anomaly payload only mentioned in live-updates spec, expects
  `{ op, record }` for incremental banner updates.)

User decided (this conversation): adopt the spec literal for SSE topic
rename + query-key rename; keep the running code's anomaly payload and
6-col back-compat (both spec gets updated to match code).

## Goals / Non-Goals

**Goals:**

- Re-align code ↔ canonical spec on the four mismatches so future agents
  reading the spec see the same contract the code implements.
- Land the deferred test layers (16.2 integration, 16.3 migration
  regression, 16.4 browser-level) so v3 has a regression net beyond the
  unit suite.
- Update `CLAUDE.md` so a fresh session can find the v3 file model and
  new CLI / API surfaces without reading the archived change.

**Non-Goals:**

- Adding new product behaviour. Every change here is either a name
  rename, a spec rewrite to match shipped code, a new test, or a doc.
- Touching `packages/core` runtime code. Core is already aligned.
- Reverting the deferred-but-shipped slices. They stay; we resync the
  spec around them.

## Decisions

### D1 — SSE topic rename: drop the alias, repurpose `experiment-change`

**Decision**: rename the internal event emitter's `experiment-doc-change`
emit point to `experiment-change`. Drop the SSE forwarder line that
emits `experiment-change` as an alias for `run-change`. From this commit
on, `experiment-change` MEANS exp-doc events (per spec); v2 listeners
still on `experiment-change` SHOULD migrate to `run-change`.

**Rationale**: spec literal wins because the alias is a one-window
hack we'd have to clean up eventually anyway. Going through the
deprecation now is cheaper than a second migration.

**Alternatives considered**:

- Keep `experiment-doc-change` as the v3 name, update spec to match.
  Rejected: spec is the long-term contract; renaming code is a
  3-line change in `apps/web/app/api/events/route.ts` +
  `apps/web/lib/events-client.ts`. Renaming spec is bigger.
- Keep alias forever. Rejected: violates "deprecated alias for ONE
  window" in the original spec. Forever-alias means forever-confusion.

### D2 — Query keys: rename `['experiments']` → `['runs']`

**Decision**: rename TanStack query keys `['experiments']` → `['runs']`
and `['experiment', id]` → `['run', id]` for run-side data; the v3
exp-doc caches keep `['experiments']` / `['experiment', id]` (matching
the spec). Touched files: every `useQuery` / `invalidateQueries` /
`prefetchQuery` in `apps/web/`.

**Rationale**: the v2 name (`experiments`) on what is now run-side data
causes consistent confusion. Spec already uses the new naming; the only
reason it didn't rename was the migration cost. The migration cost is
real (~15–20 sites) but mechanical. Doing it once removes ambiguity.

**Alternatives considered**:

- Keep current names, add a comment. Rejected: comments rot; the cache
  key is a load-bearing identifier.
- Add a v3 alias layer that maps both. Rejected: nest of complexity for
  zero benefit since callsite rename is mechanical.

### D3 — Anomaly payload: `{ project, count }` (spec adapts to code)

**Decision**: keep `recomputeAnomalies(project)` emitting
`{ project, count }`. Update `live-updates/spec.md` to remove the
`{ op, record }` per-anomaly form. The UI reacts by invalidating
`['anomalies', project]` and refetching the list.

**Rationale**: per-anomaly granularity needs `recomputeAnomalies` to
diff the previous vs new anomaly set, emit one event per added /
removed record. That's a real implementation cost (~20 lines, plus
needing to keep the previous set in memory). The benefit is
incremental banner updates, but the banner already invalidates and
refetches in <50ms — there's no perceptible UI win.

**Alternatives considered**:

- Implement spec as written. Rejected: not worth the complexity.
- Drop the `anomaly` topic entirely; let clients poll. Rejected: poll
  cost is real (every banner mounts a 30s interval). SSE pings on
  recompute is the right balance.

### D4 — v2 6-col warnings: back-compat parse, writes always emit v3

**Decision**: keep the 6-col parse path; default `run: null` for old
rows; section-bound writers always emit 7-col so the next write
upgrades the table. Update `experiment-readme/spec.md` to say "the
parser SHALL accept both 6-col and 7-col GFM tables; the section-bound
writer SHALL always emit the 7-col form." Drop the
`WARNINGS_TABLE_HEADER_MISMATCH` rejection scenario.

**Rationale**: archived data is real. Dozens of mock / production runs
have v2 6-col tables; rejecting them means the warnings card goes
"raw markdown" until someone manually edits the file. The lossless
parse is a UX win and the migration happens on first write anyway.

**Alternatives considered**:

- Spec literal (reject). Rejected: breaks the read flow for any
  un-migrated project.
- Parse 6-col but emit a warning. Already done — the parser surfaces
  a parse-issue when it back-compat-reads, just not the
  `WARNINGS_TABLE_HEADER_MISMATCH` code.

## Risks / Trade-offs

- **D1 risk**: A long-running browser tab that opened pre-rename will
  still have an SSE listener on `experiment-change` expecting run
  events. After the rename it'll receive exp-doc events instead and
  silently mis-invalidate. → **Mitigation**: SSE reconnect on tab
  refresh is cheap; the events-client.ts addEventListener is added at
  client mount, so a hard refresh (or even a soft one via
  `useMemonEvents` re-mount) picks up the new wiring. Doc the rename in
  `CLAUDE.md` so the human user knows to refresh open tabs after deploy.
- **D2 risk**: A query-key rename in the middle of a session would
  make the existing `['experiments']` cache invisible to callsites
  that now look up `['runs']`, causing one redundant fetch per cache.
  → **Mitigation**: cache miss is cheap (~50ms server-side, prod
  build); the practical impact is one extra request per page on the
  first post-deploy session.
- **D3 trade-off**: refetching the project anomalies list on every
  recompute is O(N) in anomaly count, but N is bounded (membership
  scan over runs + exp docs). Not a concern at our scale.
- **Test risk for 16.2/16.3/16.4**: These are new test layers. Mocks
  drift from prod can mask real bugs. → **Mitigation**: integration
  tests use the real route handlers (no API mock); browser tests
  exercise the same `useQuery` and `useMemonEvents` code paths a real
  user hits.

## Migration Plan

This is a code + spec sync; no on-disk schema changes. Deployment:

1. Land the rename commits on `main`.
2. Rebuild prod (`pnpm --filter @memon/web build`); restart server.
3. Open browser tabs may have stale SSE wiring — refresh once. (No data
   loss; the SSE reconnects automatically on next tab focus.)
4. The deprecation banner in `CLAUDE.md` for the legacy CLI commands
   stays as-is (separate from this change).

Rollback: revert the change PR. The on-disk file model is unchanged so
revert is just code.

## Open Questions

None. The four decisions above capture every divergence point and the
user has confirmed each direction. Test scaffolding choices (vitest vs
Playwright for 16.4) are implementation-time calls inside `tasks.md`.
