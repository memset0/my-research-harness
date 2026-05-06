---
name: memon-append-warning
description: Manual + thin wrapper for `memon experiment warning add` — append a single OPEN warning row to the parent experiment doc's `## Warnings` table, attributing it to the originating run. Use when an agent notices something on an existing run that needs human adjudication, but a full re-run / digest is not warranted. NEVER call resolve / reopen / delete from this skill.
argument-hint: <run id, category, message>
license: MIT
metadata:
  author: memset0
  version: "0.3.0"
---

# memon-append-warning

This skill is a manual for the `memon experiment warning add` CLI
subcommand — how to invoke it correctly to flag one anomaly on an
existing run. The row lands as `[OPEN]` in the **parent experiment
doc's** `## Warnings` table (not the run's own README), with the
originating run named in the `Run` column. The warning then waits
for a human to adjudicate it via the web UI or a human-typed CLI
call.

For end-of-run reviews driven by `memon-run-experiment`, the warning
add is already built into that skill's §12 (post-run anomaly review).
Use **this** skill when you (the agent) notice something about an
**existing** run in a context where re-running the whole
`memon-run-experiment` flow would be wildly disproportionate — e.g.,
while doing something unrelated you spotted that an old run's
configuration drifts from a paper you just read, or while answering a
question you noticed a baseline mismatch on a previous run.

## Preflight — FS convention version

Before doing anything else, confirm the project root's on-disk schema
matches what this skill expects. Run:

```sh
memon fs-version check --project-root . --format json
```

Branch on the `status` field:

- `match` → proceed with the rest of the skill.
- `behind` → STOP. Tell the user: "Project FS convention is at v<current>;
  current memon expects v<available>. Please run the `memon-migrate-fs`
  skill to upgrade before continuing." Do NOT read or write any spec file.
- `uninitialised` → STOP. Tell the user: "This project root has not had
  memon installed yet. Run `memon install-skills --project-root .` first."
- `ahead` → the CLI already exited 11 (`MEMON_TOO_OLD`). Forward the
  error: "Project FS convention is at v<current>; this memon supports up
  to v<available>. Upgrade memon to a release that supports v<current>
  or later." Do NOT proceed.

## When to use

- You noticed an anomaly on an existing run that the human should
  adjudicate (config drift, methodology concern, baseline mismatch
  surfaced by new evidence)
- You want to flag a finding without triggering the full
  `memon-run-experiment` flow
- The user asks you to "leave a warning on run X"

## When NOT to use

- ❌ During a fresh run drive — that's `memon-run-experiment`'s §12.
- ❌ For status changes — `memon experiment status set`.
- ❌ For free-form observations that don't need human adjudication —
  `memon-append-journal` with `--tag NOTE`.
- ❌ For things that belong in an experiment's README sections
  (Motivation, Method, Result, Conclusion, Caveats) — write those into
  the README via `memon-run-experiment` (or hand off to the user).

## Categories

The closed enum (matching `WARNING_CATEGORIES` in `@memon/core`):

| category | when |
|---|---|
| `methodology` | possible flaw in the experimental method |
| `result` | anomalous metric (loss spike, NaN, suspiciously high acc) |
| `config` | parameter drifts from baseline / paper |
| `data` | dataset / preprocessing concern |
| `repro` | reproducibility risk |
| `compare` | baseline comparison drift |
| `infra` | hardware / environment noise |
| `other` | escape hatch — prefer one of the above |

The CLI rejects out-of-enum values with `BAD_REQUEST` (exit 2).

## Orphan-run guard (read this BEFORE invoking)

Warnings live on the parent experiment doc, with the originating run
in the `Run` column. So a run that isn't bound to any experiment doc
has nowhere to put a warning. Before invoking warning add, **resolve
the parent exp**:

```sh
EXP=$(memon run resolve-exp "$RUN_ID" --project-root .)
```

Branch on the result:

- **Exit 0 + a one-line exp id on stdout** (e.g. `E0001-foo`) →
  proceed with the workflow below using `$EXP` and `$RUN_ID`.
- **Exit 1 with stderr `ORPHAN_RUN: …`** → STOP. The run has no
  experiment binding. Tell the user (in Chinese):

  > 这条 run (`$RUN_ID`) 还没有绑定到任何 experiment doc，warning
  > 没有合适的归属位置。要先用 `memon experiment link <exp-id>
  > $RUN_ID` 把它绑到对应的 experiment（或者用 `memon experiment
  > create` 新建一个），再回来加 warning。

  Do NOT silently fall back to writing on the run's own README.
  Do NOT auto-create an experiment doc.
- **Exit 4** → the run id is wrong; double-check the argument with
  the user.

## Workflow

1. **Always pass `--project-root .` explicitly.** Project convention —
   never rely on the CLI's implicit-cwd fallback.
2. Run the orphan-run guard above to get `$EXP`.
3. Pick the most specific category from the enum above.
4. Compose a one-sentence message (see "Composing the message" below).
5. Run the CLI. There are two equivalent forms — pick whichever is
   less typing:

   **Convenience form** (recommended; resolves the parent exp itself):

   ```sh
   memon run warning add "$RUN_ID" --project-root . \
     --category result \
     --message "loss curve at step 1500 has a 3x spike — possible gradient explosion not seen in baseline runs"
   ```

   **Long form** (use when you already have `$EXP` from the orphan
   guard and want to be explicit):

   ```sh
   memon experiment warning add "$EXP" --project-root . \
     --run "$RUN_ID" \
     --category result \
     --message "loss curve at step 1500 has a 3x spike — possible gradient explosion not seen in baseline runs"
   ```

   Both produce byte-identical stdout JSON + journal events; pick
   based on whether `$EXP` is already in scope from the guard step.

   Output (JSON to stdout):

   ```json
   { "ok": true, "rowId": "w_2026-05-05T14-32-00+08-00_a3f1", "mtime": 1777944643000, "hash": "..." }
   ```

   The CLI also appends a single `[WARNING]` event to `docs/journal.md`
   for the audit trail, including `run=<run-id>` so the journal alone
   is enough to reconstruct attribution.

6. **On exit 9 (CONFLICT)**: another writer touched the exp doc
   between your read and your write. Refresh and retry once:

   ```sh
   MTIME=$(memon experiment show "$EXP" --project-root . --format json | jq -r .mtime)
   memon run warning add "$RUN_ID" --project-root . \
     --category result --message "..." --expected-mtime "$MTIME"
   ```

   If the second attempt also exits 9, **stop** and surface to the user
   with the current exp doc content + mtime. Don't loop further.

## Composing the message

- One sentence, declarative, names the specific observation.
- Cite step / metric / artifact so the human can reproduce the
  observation.
- Avoid hedging language ("maybe", "I think") unless the uncertainty
  is the point.

✅ "loss curve at step 1500 has a 3x spike — possible gradient
explosion not seen in baseline runs"
✅ "batch_size=256 differs from referenced paper's 512 — affects
effective LR comparison"
❌ "something looks off"
❌ "loss spike maybe?"
❌ paste of a 50-line stack trace

If the warning is on a run that lives in a different project root
(e.g. you noticed it while doing something in another project),
you must `cd` to the right project root first — `--project-root .`
is mandatory and the run must live under it.

## Anti-patterns

- ❌ Calling `memon experiment warning resolve|reopen|delete` from
  this skill. Those are **human-only acts**. The CLI exposes them so
  the human can use them; agents must not. Even if the user says in
  conversation "this warning is resolved", point them at the web UI
  or have them type the CLI command themselves; do not run the state
  change yourself.
- ❌ Skipping the orphan guard and getting a confusing
  `BAD_STATE: ORPHAN_RUN` error. Always resolve first.
- ❌ Falling back to "write to the run's own README" when the run
  is orphan. Warnings live on exp docs by design; an orphan
  run gets bound first, then the warning.
- ❌ Adding a warning when a `memon journal append --tag NOTE` would
  do. The Warnings surface is for things that need human
  adjudication, not for general observations.
- ❌ Stuffing the message with multi-sentence prose. One sentence,
  cite the artifact, point at the observation.
- ❌ Adding multiple warnings in a loop without telling the user.
  Surface them in conversation as well so the human knows what was
  flagged.
- ❌ Picking `other` when one of the specific categories fits — the
  category groups doctor / digest reviews, so vague labels make the
  triage harder.

## Errors

| exit | meaning |
|---|---|
| 0 | row appended; rowId returned in stdout JSON |
| 1 | `BAD_STATE` — `memon run warning add` on an orphan run (resolve guard told you to bind first), OR uncategorised failure (fs error, etc.) |
| 2 | `BAD_REQUEST` (unknown category, empty message, missing flags) |
| 4 | `NOT_FOUND` (no such run id under this project root) |
| 9 | `CONFLICT` (mtime/hash mismatch — refresh + retry once) |
