## Context

Two distinct concepts have collapsed into a single `Run.mtime` field:

1. **"Did anything inside this run dir change?"** — used by the live-updates
   SSE wire and by the staleness banner. Implemented as
   `max(dirStat.mtimeMs, README.mtimeMs)` in
   `packages/core/src/discovery/read.ts:26-33`. Necessary because most
   run-side activity (artifacts, log appends) doesn't touch README.md but
   the user still wants the UI to reflect "this run is alive."

2. **"Is this README.md still at the revision the client just read?"** —
   the optimistic-locking handshake on mutating routes. Server stats only
   the README file (`fs.stat(<runDir>/README.md)`). The lock guards
   against overwriting an out-of-band edit to the same README.

The web client passes (1) to mutating routes that compare against (2),
which means any non-README file activity in the run dir produces a 409.
Reload doesn't help because (1) only ever ratchets upward.

The exp side is incidentally correct: `Experiment.path` is the `.md` file
itself, so the same identifier serves both concepts.

## Goals / Non-Goals

**Goals**

- Make the run archive button work the first time, every time, even when
  the run dir's mtime has drifted away from the README's mtime.
- Apply the same fix to every other run-side mutating route that takes
  `expectedMtime` (status, README write, warnings). One conceptual fix,
  one disciplined rollout.
- Keep `Run.mtime` (the synthesized max) so the live-updates infrastructure
  doesn't lose its "anything changed" signal.
- Preserve the optimistic-locking guarantee for the README write path —
  we MUST still 409 when a genuine out-of-band README edit happened.
- Make idempotent same-target writes (e.g. "archive an already-archived
  run") return success instead of 409 even when the mtime is stale. This
  hardens against the "double-click" / "polled while clicking" race.

**Non-Goals**

- No change to the on-disk format, the YAML frontmatter, or `JOURNAL.md`
  event grammar.
- No change to SSE wire topics or the runtime index's polling logic.
- No change to the experiment-side archive flow (it works).
- No removal of mtime locking in favor of pure hash locking. Hash locking
  alone would require always reading the file before deciding to 409,
  which we want to keep as a second-line check on NFS, not a first-line
  one.

## Decisions

### D1. Split `Run.mtime` into `mtime` (effective dir + README max) and `readmeMtime` (README only)

**Decision:** Add `readmeMtime: number` to the `Run` record. Populate it
from `readmeStat.mtimeMs` when `hasReadme === true`; set to `0` when no
README exists. Keep `mtime` as `max(dir.mtimeMs, readmeMtime)` — its
existing definition.

**Rationale:** The two concepts are genuinely different and the fix has
to make them separable at every layer (core types → API JSON → React
props → mutating server checks). A single boolean flag or a "use README
mtime instead" mode flag would be cheaper but would push the asymmetry
into the routes (each route would have to know to re-stat the README and
recompute) and still leave the staleness path tangled.

**Alternatives considered:**

- (a) Server-side fix only: re-derive `max(dir, README)` inside each
  mutating route to match the client. *Rejected* — the dir mtime keeps
  advancing between fetch and click; the server's freshly-computed max
  almost always exceeds the client's value, so 409s persist for a
  different reason.
- (b) Drop mtime locking entirely; rely on content-hash. *Rejected* —
  on NFS at one-second mtime resolution, hash locking is the only safe
  fallback for in-flight edits. But replacing the mtime check forces a
  read-then-write race window into every endpoint; the current dual
  check is correct, just keyed on the wrong stat.
- (c) Hide the new field behind a new endpoint version. *Rejected* —
  adding a field to the existing JSON is non-breaking, and the bug
  affects ALL mutating run routes, not just archive. Versioning would
  force every client to migrate at once anyway.

### D2. Idempotent "target already matches" escape hatch on archive + status

**Decision:** In `PATCH /api/runs/:id/archive` and
`PATCH /api/runs/:id/status`, when `expectedMtime !== stat.mtimeMs`,
BEFORE returning 409 re-parse the on-disk README. If
`parsedReadme.frontMatter.archived === parsed.data.archived` (archive
route) or `parsedReadme.frontMatter.status === parsed.data.status`
(status route), return 200 with `{noop: true, archived|status, mtime:
stat.mtimeMs}` — the same shape we already return on the "same target"
fast path at the top of the handler.

**Rationale:** Hardens against the double-click / "polled while clicking"
race that would otherwise survive D1 in a different form. If two clients
race to archive the same run, both observe the same target outcome and
should both succeed (one as a write, one as a noop).

**Trade-off accepted:** If a user has out-of-band-edited the README to
flip BOTH the archived flag AND some other content, and the route is
called targeting the same archived value, the rest of the out-of-band
changes are NOT communicated back to the client. We accept this because
the archive route's job is to manage one boolean; any client doing
broader edits should use the README write path which still hashes.

### D3. Idempotent same-content escape hatch on README write

**Decision:** In `writeRunReadme` (lib/experiments.ts), when the on-disk
README's `expectedMtime` is stale, hash the re-serialized request content
against the re-serialized on-disk content. If they match, return 200 with
the on-disk `mtime` / `hash` / `finalContent` instead of 409. The client
sees a successful save with no surprise content overwrite.

**Rationale:** A common case: the client's view of the README is stale
because of dir-mtime drift but the README content is IDENTICAL to what
it's trying to write (e.g. clicking "Save" on an unmodified editor with
auto-bumped updated_at backed out). Forcing a reload here is pure
friction.

**Trade-off accepted:** We are now READING the on-disk file on the 409
path (we already did, to return its content in the conflict payload),
so the additional cost is a hash compare. Negligible.

### D4. CLI parity (deferred non-blocker)

The CLI subcommands (`memon run status set`, `memon run archive`,
`memon run readme write`) already accept `--expected-mtime`. The new
escape hatches SHOULD apply there too so scripted usage isn't surprised
by a route-vs-CLI behavior split. This is in scope for this change but
implemented via a shared helper, not duplicated logic.

### D5. SSE / staleness keeps `mtime` (the max)

`Run.mtime` continues to be the SSE invalidation signal and the staleness
threshold input. The `readmeMtime` field exists purely for the lock
handshake. No SSE topic changes.

## Risks / Trade-offs

- **Missed call sites.** The biggest risk is leaving a stale
  `run.mtime` somewhere on the client path so a mutating route still
  receives the wrong value. *Mitigation:* a grep audit
  (`grep -rn 'mtime={run\.mtime\|mtime: run\.mtime\|expectedMtime={run\.mtime\|expectedMtime: run\.mtime'`)
  against `apps/web/` is the apply-phase gate (a task item). Any
  remaining match must be justified in a code comment as a deliberate
  use of the synthesized max (e.g. staleness UI).

- **`hasReadme: false` runs.** When the run has no README, `readmeMtime`
  is `0`. No mutating route should be reachable in that state (the UI
  hides the controls), but if one IS reached, the lock would compare
  against `stat(README).mtimeMs` which is the just-created mtime — i.e.
  a fresh-write race that the server resolves correctly.
  *Mitigation:* Tests SHOULD cover the "synthesized run" path so the
  invariant "controls hidden when `hasReadme: false`" is enforced from
  the API side, not just the React side.

- **Compatibility with old clients.** A web client built before this
  change still sends `run.mtime` (the max). Most of the time this 409s
  (the existing bug); occasionally it works (when dir.mtime equals
  README.mtime). After this change, the server behavior on the 409 path
  gains the D2/D3 noop escape hatches, which only ever convert former
  409s to 200s — never breaks an old client.

- **JOURNAL noise.** Idempotent noop writes (D2, D3) SHALL NOT append
  `[ARCHIVE]` / `[STATUS]` journal events (existing same-target fast path
  is already noop-and-silent; the new escape-hatch path falls through to
  the same logic). Reviewers should verify this in the apply-phase
  diff.

- **NFS subtlety.** On NFS with second-resolution mtimes, the existing
  hash check is the safety net. The README write path keeps both. The
  archive / status routes don't currently check hash (they don't accept
  an `expectedHash`); D2 sidesteps this by reading the file on the 409
  path and checking the *target* field directly, which is a stricter
  signal than hashing the full file (it tolerates legitimate
  concurrent edits to other fields).

## Migration Plan

This is a wire-additive + client-update change with no on-disk format
shift. Sequence:

1. Land `readmeMtime` on the `Run` core type + discovery layer.
2. Update API JSON to include the field.
3. Switch web client call sites from `run.mtime` to `run.readmeMtime`.
4. Land the route-side noop escape hatches (D2, D3).
5. Mirror in the CLI helpers (D4).

No rollback action is required if any step misbehaves: the field simply
goes unused on the web client, and the route-side escape hatches strictly
loosen 409 → 200 for safe cases.
