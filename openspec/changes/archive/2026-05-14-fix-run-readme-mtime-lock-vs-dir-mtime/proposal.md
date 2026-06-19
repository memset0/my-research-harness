## Why

Archiving a run from the dashboard fails with `409 CONFLICT — on-disk mtime
differs from expectedMtime`, and clicking the "Reload" recovery action does
not fix it — the next click 409s again. Archiving an experiment doc from
the same UI works fine. The asymmetry is a real on-disk-vs-in-memory bug,
not user error.

Root cause: the discovery layer derives an effective `Run.mtime` as
`max(dir.mtimeMs, README.md.mtimeMs)` (see
`packages/core/src/discovery/read.ts:26-33`) so SSE / staleness detection
can react to *anything* changing inside the run dir. The client passes that
synthesized value to mutating routes as `expectedMtime`. But the server
routes (`PATCH /api/runs/:id/archive`, `PATCH /api/runs/:id/status`,
`PUT /api/runs/:id/readme`, all `warnings` routes) compare it against
`fs.stat(<runDir>/README.md).mtimeMs` — just the README's mtime. Any
non-README file activity in the dir (artifact writes, log appends,
short-lived `.tmp` files from atomic-rename writes elsewhere, `find`
metadata touches, the user's training script writing into the run dir,
even our own `appendJournalEvent` if the journal happens to live alongside
the README) bumps the dir mtime without touching README.md → `run.mtime
> README.mtime` permanently → server always 409s.

Reload doesn't help because a fresh GET returns the same `max(dir, README)`
and the dir keeps drifting between fetch and click.

Experiment archive works because `Experiment.path` IS the `.md` file (no
dir layer) — `exp.mtime = stat(exp.path).mtimeMs` and the server stats the
same file. Symmetric, no mismatch.

## What Changes

- Split the run record's `mtime` into two distinct values with different
  semantics. `Run.mtime` keeps its current meaning — `max(dir.mtimeMs,
  README.mtimeMs)` — used for SSE invalidation, staleness banners, and
  the runtime index's change-detection. A NEW field `Run.readmeMtime`
  carries `README.md`'s mtime in isolation (or `0` when `hasReadme=false`)
  and is the value clients SHALL pass as `expectedMtime` to mutating
  routes.
- Web client updates: every component that currently passes `run.mtime`
  to a mutating endpoint (`<ArchiveToggle>`, `<StatusEdit>`, the README
  editor's load path, warnings UI) switches to `run.readmeMtime`. SSE
  invalidation and "stale" badges continue to use `run.mtime`.
- API response shape: `GET /api/runs/:id` and the list endpoint SHALL
  include `readmeMtime` on every run. The web `api.ts` `Run` and
  `RunDetail` projections are extended to carry it.
- Server-side hardening for `PATCH /api/runs/:id/archive` and
  `PATCH /api/runs/:id/status`: when the client-supplied `expectedMtime`
  matches `README.mtime` we proceed as today. When it does NOT, before
  returning 409 we re-parse the on-disk README content and check whether
  the field we are about to modify (`archived` for archive, `status` for
  status) **already equals the requested target**. If yes → return the
  existing 200 `{noop: true}` shape rather than 409. This makes
  "double-click while a poll just landed" safe and idempotent.
- Idempotent same-target writes on `PUT /api/runs/:id/readme`: when
  `expectedMtime` is stale AND the on-disk content hash already equals
  the hash of the canonical re-serialization of `body.content`, return
  200 with the current `mtime` / `hash` / `finalContent` instead of 409
  (the write is a no-op anyway).
- CLI parity: the `memon run status set` / `memon run archive` /
  `memon run readme write` family already accepts `--expected-mtime`.
  The same "stale-but-target-already-matches → 0 noop" semantics extend
  to those CLI subcommands so scripted / CI use cases stop seeing
  spurious exit-9 failures.

NOT a BREAKING change. The on-disk format is unchanged. The wire schema
adds a field (`readmeMtime`) — existing clients that ignore it continue
to work because the server still accepts the old `expectedMtime` value
when it happens to equal the README mtime. The CLI / response shapes
remain backwards-compatible additions.

## Capabilities

### New Capabilities

(none — this is a defect fix layered on existing capabilities)

### Modified Capabilities

- `run-discovery`: `Run` record gains a `readmeMtime` field separate
  from `mtime`. Discovery layer SHALL populate it from `stat(README.md)`
  (or `0` when no README is present).
- `run-edit`: `expectedMtime` lock for mutating run routes (status,
  README write, archive, warnings) is now defined as the README.md's
  mtime, not the synthesized run-dir mtime. Adds the "target-already-
  matches → idempotent 200 noop" escape hatches described in **What
  Changes** above.
- `archive-frontmatter`: web archive flow now passes `run.readmeMtime`
  (not `run.mtime`) as `expectedMtime`. Server adds the
  "already-archived-or-already-unarchived → noop" idempotency when the
  mtime is stale.

## Impact

**Affected code**

- `packages/core/src/types.ts` — add `readmeMtime: number` to `Run`.
- `packages/core/src/discovery/read.ts` — populate `readmeMtime` from
  the README stat (0 when synthesized).
- `packages/core/src/discovery/*.test.ts`, `index.test.ts`,
  `stale.test.ts` — update fixtures to construct `Run` with the new
  field. Existing assertions on `mtime` (the max) are preserved.
- `apps/web/lib/api.ts` — extend the `Run` / `RunDetail` `Pick`
  projections to include `readmeMtime`.
- `apps/web/app/api/runs/route.ts`, `apps/web/app/api/runs/[id]/route.ts`
  — return `readmeMtime` in the JSON payload.
- `apps/web/components/archive-toggle.tsx`,
  `apps/web/components/status-edit.tsx`,
  `apps/web/components/readme-editor.tsx`,
  `apps/web/components/experiment-page.tsx` — pass
  `run.readmeMtime` instead of `run.mtime`. Warnings UI (if any)
  similarly switches.
- `apps/web/app/api/runs/[id]/archive/route.ts`,
  `apps/web/app/api/runs/[id]/status/route.ts` — add the idempotent
  "target already matches" escape hatch before the 409.
- `apps/web/lib/experiments.ts` (`writeRunReadme`) — same escape hatch
  when stale mtime + matching content hash.
- `packages/core/src/cli/run-status-set.ts`,
  `packages/core/src/cli/run-archive.ts`,
  `packages/core/src/cli/run-readme-write.ts` — match the route
  behavior for parity (so `memon run …` stays a faithful CLI mirror).

**APIs**

- Wire-level addition only: `readmeMtime: number` in run list / detail
  responses. No removals, no renames, no status code changes for the
  happy path. The error→200 transition for "target already matches"
  is observable but strictly recovers cases that used to fail spuriously.

**Dependencies / systems**

- No new packages.
- SSE / live-updates remain on `Run.mtime` so cluster-mate file
  activity still triggers refresh.

**Risks**

- The biggest risk is missing a call site that still passes
  `run.mtime`. A grep audit (`run\.mtime` in `apps/web/components/`
  and `apps/web/app/`) gates the apply phase.
- For the "target already matches" idempotent path: care must be
  taken to STILL emit the 409 when *content* differs in a way that
  isn't just the target field flipping. The escape hatch covers only
  the exact case where the on-disk file already contains the requested
  end state.
