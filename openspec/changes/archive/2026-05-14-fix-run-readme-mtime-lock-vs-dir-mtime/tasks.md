## 1. Core type + discovery layer

- [x] 1.1 Add `readmeMtime: number` to the `Run` interface in
  `packages/core/src/types.ts` (just below the existing `mtime` field).
  Document the semantic split with a one-line comment: "`mtime` is
  max(dir, README) for SSE/staleness; `readmeMtime` is the README's
  own mtime for optimistic locking. `0` when `hasReadme: false`."
- [x] 1.2 In `packages/core/src/discovery/read.ts`, capture
  `readmeStat.mtimeMs` into a local before the existing `if
  (readmeStat.mtimeMs > mtime)` line, and set `readmeMtime` on the
  returned record. In the `hasReadme === false` branch, set
  `readmeMtime: 0` on the returned record.
- [x] 1.3 Update fixtures in `packages/core/src/discovery/discover.test.ts`,
  `index.test.ts`, `stale.test.ts`, `read.test.ts` to include
  `readmeMtime` in any inline `Run` literals (TS will flag them; fix
  them by mirroring `mtime` or setting to `0` for synthesized cases).

## 2. Web API JSON shape

- [x] 2.1 In `apps/web/lib/api.ts`, extend the `Run` type's `Pick<...>`
  list and the `RunDetail` type's `Pick<...>` list to include
  `readmeMtime`.
- [x] 2.2 Verify `apps/web/app/api/runs/route.ts` and
  `apps/web/app/api/runs/[id]/route.ts` pass through the new field
  unchanged (they currently spread the run record into JSON; if any
  hand-picked projection exists, add `readmeMtime` there).

## 3. Web client call-site migration

- [x] 3.1 In `apps/web/components/experiment-page.tsx`, change the
  `<ArchiveToggle ... expectedMtime={run.mtime} />` call site (line ~287)
  to `expectedMtime={run.readmeMtime}`.
- [x] 3.2 In the same file, change the `<StatusEdit ... expectedMtime=
  {run.mtime} />` call site (line ~280) to `expectedMtime={run.readmeMtime}`.
- [x] 3.3 In `apps/web/components/readme-editor.tsx` (and any sibling
  that loads the run README for editing), switch the `expectedMtime`
  baseline from `run.mtime` to `run.readmeMtime`.
- [x] 3.4 Grep audit: `cd apps/web && grep -rn 'expectedMtime=\|expectedMtime:' app/ components/`
  and confirm every match for a RUN-side endpoint uses
  `run.readmeMtime` (or the editor's locally-tracked baseline). Any
  remaining `run.mtime` usage for `expectedMtime` purposes must be
  fixed or commented with a justification.
- [x] 3.5 Sanity-check the exp-side: `<ArchiveToggle kind="exp" ...
  expectedMtime={exp.mtime} />` should NOT change (exp.path IS the
  .md file).

## 4. Server-side route hardening (idempotent escape hatches)

- [x] 4.1 In `apps/web/app/api/runs/[id]/archive/route.ts`, when the
  `expectedMtime` mismatch branch fires, re-parse the on-disk README
  (which we're already reading for the conflict payload) and check
  `parsedReadme.frontMatter.archived === parsed.data.archived`. If yes,
  short-circuit to a 200 noop response shape (mirror the existing
  same-target fast path at line ~85). Update the comment header to
  document the idempotent behavior.
- [x] 4.2 Same pattern in `apps/web/app/api/runs/[id]/status/route.ts`:
  on `expectedMtime` mismatch, parse the on-disk content and short-
  circuit to 200 if the on-disk status already equals the requested
  status.
- [x] 4.3 In `apps/web/lib/experiments.ts` `writeRunReadme`, refactor
  the `readWithLock` call into a try/catch (or pre-stat) so on a 409
  due to mtime drift we can: (a) re-serialize the request `content`,
  (b) re-serialize the on-disk content, (c) compare canonical-hash. If
  equal, return success with the on-disk mtime/hash/finalContent
  without rewriting. Otherwise propagate the 409 unchanged.

## 5. CLI parity (D4)

- [x] 5.1 In the run-side CLI archive command (locate via `grep -rn
  "memon-run-archive\|'archive'" packages/core/src/cli/`), add the
  same "stale mtime but target already matches → exit 0 noop" path
  as in 4.1. Reuse a shared helper if natural (e.g. a tiny
  `isStaleButTargetMatches` utility in `packages/core/src/archive` or
  inline if it stays under ~10 lines).
- [x] 5.2 In the run-side CLI status-set command, mirror 4.2's
  semantics (same target → exit 0 noop on stale mtime).
- [x] 5.3 In the run-side CLI README-write command, mirror 4.3's
  semantics (identical canonical content → exit 0 success on stale
  mtime).

## 6. Tests

- [x] 6.1 Add a unit test in `packages/core/src/discovery/read.test.ts`
  asserting `readmeMtime` equals the README stat, not the dir stat,
  even when an unrelated file in the dir was touched after the
  README write. Use a fixture run dir with a known mtime gap.
- [x] 6.2 Add an integration test for `PATCH /api/runs/:id/archive`
  exercising the bug scenario directly: write a README, touch the dir
  to bump its mtime, then archive with `expectedMtime: <readmeMtime>`
  and assert 200 (file located co-located with the existing route
  test pattern; if no such test file exists, create
  `apps/web/app/api/runs/[id]/archive/route.test.ts`).
- [x] 6.3 Add the "double-archive race" test: two sequential PATCHes
  with the same `archived: true` target; second uses a stale
  `expectedMtime`; expect 200 `{noop: true}`. Assert only one
  `[ARCHIVE]` event in the test JOURNAL.
- [x] 6.4 Add a test for `PUT /api/runs/:id/readme` exercising the
  D3 escape hatch: stale `expectedMtime` + identical canonical
  content → 200, no JOURNAL event, no mtime bump.
- [x] 6.5 Add a negative test: stale `expectedMtime` + DIFFERENT
  target → 409. Same for the archive and status routes. Confirms the
  escape hatch doesn't over-loosen.

## 7. Manual verification per `CLAUDE.md` UI protocol

- [x] 7.1 Build prod and start: `pnpm --filter @memon/core build &&
  pnpm --filter @memon/web build && cd apps/web && pnpm start > /tmp/memon-prod.log 2>&1 &`
  (after killing any previous server holding 3737 per the CLAUDE.md
  kill-old-process-first rule).
- [x] 7.2 Pick a real FINISHED run with a recent log/artifact touch in
  the project. Hit `GET /api/runs/<id>` with curl + Basic auth, confirm
  the JSON contains both `mtime` and `readmeMtime` and the two values
  differ (this is the regression seed).
- [x] 7.3 Click "Archive" in the dashboard. Verify a single toast
  `Archived <id>` appears, no 409 toast, the page badges update to
  show the archived state, and `JOURNAL.md` has a new `[ARCHIVE]
  op=archive` line.
- [x] 7.4 Click "Unarchive". Verify it round-trips without 409.
- [x] 7.5 Repeat the same flow on an exp doc to confirm we didn't
  regress the working path.

## 8. Verification commands (typecheck + unit)

- [x] 8.1 `pnpm --filter @memon/core typecheck`
- [x] 8.2 `pnpm --filter @memon/web typecheck`
- [x] 8.3 `pnpm --filter @memon/core test -- --run discovery/read.test`
- [x] 8.4 `pnpm --filter @memon/web test -- --run runs/.*/archive.*route.test`
  (skip if test file pattern differs after 6.2 lands)
- [x] 8.5 `openspec validate fix-run-readme-mtime-lock-vs-dir-mtime --type change`
