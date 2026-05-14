---
name: memon-run-experiment
description: Run an existing launcher script (optionally with hyperparameter env-var overrides), watch it through stable RUNNING, then write + finalize the run's README. The script handles its own run dir; this skill writes the README and drives the lifecycle around it, iterating through fixes when the script doesn't run cleanly.
argument-hint: <script path + optional env vars; or experiment description>
license: MIT
metadata:
  author: memset0
  version: "0.5.0"
---

# memon-run-experiment

## Preflight — FS convention version

Run `memon fs-version check --project-root . --format json` as the first
step. If `status !== "match"`, STOP and follow the branch protocol in
`../PREFLIGHT.md` (covers `match` / `behind` / `uninitialised` / `ahead`).

## When to use

- The user asks you to run an existing launcher script and own the run's README lifecycle
- A sweep needs to fire across multiple env-var configurations of an existing script
- A previous run failed and the user asks you to retry / resume / iterate-and-fix
- The user pointed at a specific run dir and wants you to keep going (resume case)
- The user described an experiment but wants you to drive both authoring AND running (delegate to `memon-write-script` first, then come back)

## When NOT to use

- ❌ The user wants to write a new script with no intent to run it now — handoff to `memon-write-script` only
- ❌ For ad-hoc shell commands that don't produce a structured run dir — run them directly
- ❌ For aggregate analysis across multiple existing runs — that's `memon-write-report` or `memon-digest-journal`
- ❌ For one-off "just record this observation" with no actual training — `memon-append-journal --tag NOTE`

## Prerequisite — read `CLAUDE.md` first

Before doing anything else, read `<projectRoot>/CLAUDE.md` if it exists.
memon-using projects rely on it for project-specific conventions (env
load, GPU layout, dataset locations, what `LOGS_DIR` is, etc.). Skipping
this routinely causes wasted runs.

If `CLAUDE.md` is absent, ask the user once whether there's an
equivalent (e.g. `AGENTS.md`, `docs/setup.md`).

## What this skill does

Drive an **already-written** launcher script from "click go" to
"finalized README":

1. Pre-launch sanity check — `which python` + `python -V`, `torch.cuda.is_available()`,
   `nvidia-smi` for free / healthy GPUs. Bail out before launch if the
   env is wrong or every GPU is busy.
2. Capture `code.diff` (uncommitted changes vs HEAD, filtered).
3. Wandb pre-flight if applicable.
4. Launch the script (sync or in `tmux`). The script handles its own
   `RUN_DIR` derivation, run-dir creation, and log piping. It does NOT
   write `README.md` — that's this skill's job.
5. Detect the run dir from the script's early `[memon] ...` output and
   deposit `code.diff` + `code.head` into it.
6. Wait for stable RUNNING (~60s of growing log, no immediate crash).
7. Write the README with full Motivation / Setup / Method
   (`status: RUNNING`).
8. Periodic check every ~120 min until terminal state.
9. On `FINISHED` → final README write with Result / Conclusion + brief
   Chinese walkthrough in conversation.
10. On `FAILED` → minimal README with 1-line failure note in Result.
11. Recovery: when the script doesn't launch cleanly, **iterate inside
    the agent's ability** — read the error log, apply fixes, re-launch
    — until it runs. Document every change in the final README's
    Method section.

You are the **agent that owns the README** for this run. The script
doesn't write README at all — frontmatter and all body sections come
from this skill.

## Inputs the user can give you

- **A script path** to execute (e.g. `scripts/erdos/run.sh`) plus
  optional env-var overrides (`BS=16`, `LR=1e-4`, etc.). This is the
  common case — scripts are typically already written.
- **A description** when no script exists yet — first delegate authoring
  to `memon-write-script`, then come back here. (Rarer.)
- **An existing run dir** to resume into — pass `RUN_DIR=<path>` to the
  script.

## What you do NOT need to track

- `PROJECT_ROOT`, `LOGS_DIR` — the script knows where its run dir lands.
- `RUN_NAME` — usually leave the script's default. Override **only**
  when running a sweep, where each iteration needs a distinct slug
  (e.g. `RUN_NAME=bs16 BS=16 bash run.sh`).
- The exact filesystem layout of run dirs — discover it from the
  script's output (see §3 below).

## Workflow

### 0. Identify (or create) the parent experiment doc

Every run dir SHOULD be bound to a `docs/experiments/E<NNNN>-<slug>/README.md` (v5 folder layout)
file that owns motivation / method / conclusion / caveats / warnings across
the run set. The run README itself only carries setup / result / artifacts.
Decide which experiment this run belongs to **before** launching, so the
binding lands atomically at Phase 1 in §3, right after the proof-of-life first write.

```sh
# List existing experiments in this project.
memon experiment ls --project-root . --format human
```

Branch:

- **An existing experiment fits** (the user's described work matches one of
  the listed experiments' motivation/method) → ask the user to confirm the
  pick. Capture its id as `$PARENT_EXP_ID` (e.g. `E0001-vpred-convergence`).
- **No existing experiment fits** → propose creating a new one (in Chinese):

  > 这个 run 看起来不属于任何已有 experiment。我建议新建一个：
  > slug=`<slug>` title=`<title>`，hypotheses=[…]。可以吗？

  On user confirmation:

  ```sh
  memon experiment create "<slug>" --project-root . \
    --title "<one-line title>" \
    --hypotheses H0003,H0007        # comma-separated; omit if none
  ```

  Capture the returned id (`E<NNNN>-<slug>`) as `$PARENT_EXP_ID`. The CLI
  writes the exp doc with empty section stubs that you (or the user) fill
  in afterwards — typically while doing the Phase 2 expansion in §6 the
  agent also writes Motivation/Method into the exp doc on the user's behalf.

  If the user has forward-looking ideas like "next try X / Y / Z" at this
  point, write them into `## Plan` as `- [ ]` task items, NOT as bullets
  in `## Method`. Method describes stable methodology; Plan holds
  forward-looking TODOs (and later, per-run reflection sub-bullets).
  Resulting section order: `Motivation` → `Method` → `Plan` →
  `Conclusion` → `Caveats` → `Warnings`.

- **The user explicitly wants this run to be orphan** (e.g. a one-off
  smoke test that doesn't deserve an experiment doc) → set
  `$PARENT_EXP_ID=""` and skip the link step in §3 (Phase 1). This is rare; default
  is "always have an exp doc".

The actual bidirectional binding (writing `experiment:` to the run
frontmatter + appending the run dir name to the exp's `runs[]`) happens
in §3 at Phase 1, when the first README + link both fire. See §3.

### 1. Pre-launch — env + GPU sanity check, then capture `code.diff` + wandb pre-flight

**a. Env / GPU sanity check.** Before launching, verify the environment
the script is about to run in. Cheap, ~2 seconds, catches the most
common "ran the wrong python / no free GPU" failure modes:

```sh
# 1) Which python? Right env active?
which python && python -V
# If the script `conda activate`s, this still helps you catch mismatches
# in the OUTER shell vs what the script will activate.
python -c 'import torch, sys; print("torch", torch.__version__,
  "cuda", torch.version.cuda, "available", torch.cuda.is_available(),
  "ndev", torch.cuda.device_count())' 2>/dev/null || \
  echo "WARN: torch import failed in current env (script's `conda activate` may fix this)"

# 2) GPUs healthy and free?
nvidia-smi --query-gpu=index,name,memory.used,memory.total,utilization.gpu \
           --format=csv,noheader
```

What to look for:

- `python -V` matches what the script expects (3.10 vs 3.11, etc.).
- `torch.cuda.is_available()` is `True`. If `False` and the script is
  GPU-bound → stop, surface to the user.
- All requested GPUs idle (memory.used ≈ 0, utilization ≈ 0). If
  another process is hogging them → stop, ask the user before clobbering.
- Driver / CUDA pair sane (no "driver too old" warning from `nvidia-smi`).

If the script handles its own env via `conda activate <env>`, this
outer check is informational — the in-script activation is what
ultimately decides. But mismatches between the outer shell and the
script's expected env are still worth flagging in conversation.

If the user passed `CUDA_VISIBLE_DEVICES=...`, scope the
`nvidia-smi` check to those device indices.

Bail out (don't launch) if:
- `nvidia-smi` itself fails (driver missing).
- A GPU you intend to use is already at >5% memory in use by another
  process — surface in conversation, ask the user.
- `python` can't be found at all and the script doesn't `conda activate`.

**b. Capture `code.diff` + `code.head`** — diff is **allowlist-based**:
include only source/code files, never data/binary/log artifacts.

The allowlist is **project-specific** and lives in the project's
`CLAUDE.md` under a section named `## code.diff allowlist` (one
pathspec per line). Read it from there:

```sh
ALLOWLIST=$(awk '
  /^## code\.diff allowlist/ { in_section = 1; next }
  in_section && /^## / { exit }
  in_section && /^[^#[:space:]]/ { print }
' "$PROJECT_ROOT/CLAUDE.md")
```

Default allowlist (used **only as a starting point** when the project
hasn't declared one yet — see "First-time setup" below):

```
*.py
*.pyx
*.pyi
*.ipynb
*.sh
*.bash
*.c
*.cc
*.cpp
*.h
*.hpp
*.cu
*.cuh
*.go
*.rs
*.ts
*.tsx
*.toml
*.yaml
*.yml
Makefile
*.mk
Dockerfile
```

```sh
TMP_DIFF=$(mktemp)
TMP_HEAD=$(mktemp)
git rev-parse HEAD > "$TMP_HEAD" 2>/dev/null || true

# Convert each allowlist entry into a pathspec arg.
PATHSPEC=()
while IFS= read -r pat; do
  [ -z "$pat" ] && continue
  PATHSPEC+=( ":(glob)**/$pat" )
done <<< "$ALLOWLIST"

git diff HEAD -- "${PATHSPEC[@]}" > "$TMP_DIFF" 2>/dev/null || true
```

**First-time setup** — if the project's `CLAUDE.md` has no
`## code.diff allowlist` section, this is a brand-new project and the
allowlist needs to be seeded. Don't silently fall back to the default;
do this once, interactively:

1. Run `git ls-files "$PROJECT_ROOT" | sed -n 's/.*\.//p' | sort | uniq -c | sort -rn | head -20`
   to see what file extensions actually exist.
2. From that, propose an allowlist (intersect with the defaults above
   plus any project-specific extensions you spot — `.lua`, `.cuh`,
   `.proto`, etc.).
3. Show it to the user, ask for confirmation / edits.
4. **Append a `## code.diff allowlist` section to `CLAUDE.md`** with
   the agreed list. Future runs read from it instead of re-asking.

After the first run, every subsequent invocation just reads the
section — no more prompts.

**c. Wandb pre-flight.** If the script imports `wandb` (grep the script
and any sibling `.py` it sources), the run is **wandb-tracked** and must
succeed online:

1. Confirm `WANDB_API_KEY` (or `~/.netrc`) is configured. If absent →
   stop and ask the user.
2. `curl -sS https://api.wandb.ai/graphql --max-time 5 -o /dev/null -w "%{http_code}"`.
   Non-2xx → stop and ask the user.
3. **Never** silently fall back to `WANDB_MODE=offline`.

### 2. Launch

For **short** scripts, run sync and capture stdout:

```sh
LAUNCH_OUT=$(mktemp)
ENV_VARS bash <script> 2>&1 | tee "$LAUNCH_OUT"
EXIT=$?
```

(`ENV_VARS` = optional space-separated `BS=16 LR=1e-4 …` for sweep
overrides.)

For **long** scripts, use `tmux`:

```sh
SESSION="memon-claude-${RUN_NAME:-run}-$(date +%s)"
tmux new-session -d -s "$SESSION" "ENV_VARS bash <script>"
```

#### Resume — fresh launch vs. continuing an existing run dir

Two cases to distinguish before launching:

- **Fresh run** (the default): just run the script. It computes a new
  `RUN_DIR` with a fresh timestamp, creates the dir, and starts piping
  to a new `run.log`. README will be written by this skill in §6.
- **Resume** (the user pointed at a specific existing run dir, OR a
  previous run crashed and we want to continue rather than start over):
  pre-set `RUN_DIR` so the script reuses that dir. The script's
  `tee -a` appends to the existing `run.log`; an existing `README.md`
  from the prior run is preserved and updated by this skill in §6.

```sh
RUN_DIR=<projectRoot>/<LOGS_DIR>/<RUN_NAME>-<TIMESTAMP> ENV_VARS bash <script>
```

What you, the agent, are responsible for in the resume case (script
itself only honors `RUN_DIR`):

1. **Verify the dir exists** and contains the artifacts a resume needs
   (typically `checkpoints/`, optionally a partial `run.log` and the
   prior `README.md`). If absent, this isn't a resume — fall back to a
   fresh launch.
2. **Read the existing `README.md`** for context — its `MTIME`, current
   `status`, anything in `## Result` / `## Caveats` from the prior run.
   Carry `MTIME` forward; you'll need it to update the README without
   triggering a CONFLICT in §6.
3. **Confirm with the user** that resume is the right call (vs. a fresh
   run). If the prior run failed because of a config bug you've now
   fixed, a fresh run dir is usually cleaner — resume is for runs that
   were healthy but just need more time / more data / a checkpoint
   continuation.
4. **The log appends.** A conforming launcher uses `tee -a "$RUN_DIR/run.log"`
   so the new run's stdout is appended to the existing `run.log`. Don't
   overwrite or truncate. If the script you're resuming uses plain `tee`
   (truncate), surface that to the user — they may want to manually
   archive the old log first, or you can fix the script via
   `memon-write-script`.

Skip the `code.diff` capture in §1 for resume? **No** — capture it
again. The repo state at resume time may differ from when the run was
originally launched (e.g. the user fixed a bug). Each resume gets its
own snapshot, written as `code.diff.<resume-timestamp>` next to the
original.

### 3. Read `[memon] ...` lines from the script's output

A conforming script (per `memon-write-script` Convention #5) echoes
three lines at start, all prefixed with `[memon] `:

```
[memon] PROJECT_ROOT=<absolute path>
[memon] RUN_NAME=<slug>
[memon] RUN_DIR=<absolute path>
```

Grep each one out — no globbing, no source-reading, no timestamp
inspection needed:

```sh
# sync case — read from the captured stdout
extract() { grep -m1 "^\[memon\] $1=" "$LAUNCH_OUT" | sed "s|^\[memon\] $1=||"; }
PROJECT_ROOT=$(extract PROJECT_ROOT)
RUN_NAME=$(extract RUN_NAME)
RUN_DIR=$(extract RUN_DIR)

# tmux case — capture pane after a brief delay so the early lines exist
sleep 2
tmux capture-pane -p -t "$SESSION" > "$LAUNCH_OUT"
PROJECT_ROOT=$(extract PROJECT_ROOT)
RUN_NAME=$(extract RUN_NAME)
RUN_DIR=$(extract RUN_DIR)
```

If a script does NOT emit these lines, it doesn't follow conventions —
ask the user to update the script (handoff to `memon-write-script`) or
to identify the run dir manually. Don't try to recover by grepping
filesystem — the contract is "the script tells you where it ran".

#### Proof-of-life check

Before Phase 1 fires, confirm the script reached a state where it's
actually doing something. Two conditions:

1. `$RUN_DIR` was extracted above (we know where the run lives).
2. `$RUN_DIR/run.log` exists and has non-zero size (the script got
   past `mkdir -p` and `tee` is producing output).

A small retry window handles the case where the `[memon]` echo flushed
before the log file's first content:

```sh
RUN_LOG="$RUN_DIR/run.log"
for _ in 1 2 3 4 5; do
  [ -s "$RUN_LOG" ] && break
  sleep 1
done
if [ ! -s "$RUN_LOG" ]; then
  # Script didn't produce any log output within 5s — proof-of-life
  # failed. Do NOT write Phase 1. Surface to the user as a §3 fallback
  # (no contract violation, but unusual; consider §10b's rare-edge path
  # if the script also already exited).
  echo "WARN: $RUN_LOG empty after 5s — proof-of-life check failed"
fi
```

If proof-of-life succeeds, continue to Phase 1. If it fails, do NOT
write a Phase 1 README; the script is either silently stalled (handoff
to user) or already crashed without output (treat as §10b's rare edge).

#### Phase 1 — First README write (minimal) + `memon experiment link`

The Phase 1 README locks the run ↔ exp linkage immediately. It carries
complete frontmatter but a placeholder body (`## Setup` content is
filled in at Phase 2 in §6 after stable RUNNING confirms; this Phase 1
write only proves "the run exists and is bound").

```sh
RUN_ID=$(basename "$RUN_DIR")
NOW=$(date +%Y-%m-%dT%H:%M:%S%:z)
cat <<EOF | memon run readme write "$RUN_ID" --project-root . --expected-mtime 0
---
id: $RUN_ID
name: <RUN_NAME or whatever the script defaulted to>
status: RUNNING
created_at: $NOW
updated_at: $NOW
experiment: $PARENT_EXP_ID    # from §0; empty/omit if intentional orphan
finished_at: null
host: $(hostname)
pid: <captured if available>
gpus: [...]
entry: <path-relative-to-project-root, e.g. scripts/erdos/run.sh>
command: bash <path-relative-to-project-root>
wandb: <wandb-url-or-null>
---

## Setup
(pending — full setup written after stable RUNNING in §6)

## Result
(pending — written when the run reaches a terminal state)

## Artifacts
- \`./run.log\` — full stdout/stderr
- \`./code.diff\` — uncommitted changes at launch (code only)
- \`./code.head\` — git HEAD at launch
- \`./checkpoints/\` — model weights (if produced)
EOF
```

Capture the returned `mtime` as `$MTIME` — this is the handle every
later update (Phase 2 expansion in §6, periodic updates in §7+,
terminal writes in §9 / §10) MUST pass via `--expected-mtime`.

Then bind the run to its parent experiment (skip when `$PARENT_EXP_ID`
is empty / orphan-by-choice):

```sh
memon experiment link "$PARENT_EXP_ID" "$RUN_ID" --project-root .
```

This is the atomic bidirectional bind: `<run>.experiment` and
`<exp>.runs[]` stay in sync. The `experiment:` field already in the
Phase 1 README is consistent (no rewrite happens), but the exp doc's
`runs[]` gains the new entry. The link is locked WHILE the run is
still alive — that's the whole point of Phase 1 firing here rather
than after stable RUNNING.

### 4. Drop in code snapshots

By this point §3 has already written the Phase 1 README and locked
the `memon experiment link`. The script meanwhile has its `$RUN_DIR`
created and is teeing to `run.log`. §4's job: deposit the code
snapshots whose paths the Phase 1 README's `## Artifacts` list already
named, so those claims are backed by files on disk before §6 expands
the Setup body.

**Fresh launch**: snapshots go in as plain `code.diff` + `code.head`.

**Resume**: snapshots go in as `code.diff.<resume-iso>` +
`code.head.<resume-iso>` so prior snapshots are preserved.

```sh
mv "$TMP_DIFF" "$RUN_DIR/code.diff"        # or code.diff.<resume-ts> on resume
mv "$TMP_HEAD" "$RUN_DIR/code.head"        # or code.head.<resume-ts> on resume
```

### 5. Wait for stable RUNNING

`tail` the log briefly; the script must be growing it without an
immediate crash:

```sh
RUN_LOG="$RUN_DIR/run.log"
sleep 60
LINES=$(wc -l < "$RUN_LOG" 2>/dev/null || echo 0)
[ "$LINES" -lt 5 ] && echo "WARN: run.log only $LINES lines after 60s; possible silent stall"
```

If the script returned non-zero in sync mode (or the tmux session
already exited), skip to §10a (the existing-README failure path). The
Phase 1 README written in §3 already exists; §10a will flip its status
to FAILED via mtime-locked update. §10b is for the rare edge where
Phase 1 itself never fired.

### 6. Phase 2 — Expand the README after stable RUNNING

§3 already wrote the Phase 1 README (`status: RUNNING`, complete
frontmatter, placeholder body) and locked the `memon experiment link`.
§5 just confirmed the script survived ~60s. §6's job is to UPDATE that
existing README — mtime-locked — and replace the `## Setup` placeholder
with the full env / hardware / hyperparams content. Status stays
`RUNNING`; this is an expansion, not a fresh write.

The mtime to pass is the one captured at the end of §3's Phase 1 write
(`$MTIME`). On exit 9 (CONFLICT — another writer touched the README
between §3 and §6), refresh: `MTIME=$(memon show "$RUN_ID"
--project-root . --format json | jq -r .mtime)`, re-apply, retry once.

**Resume case**: the run dir already existed from a prior run; §3's
Phase 1 detected the existing README via the `--expected-mtime`
fail-and-refresh path and used the prior mtime as its starting point.
By §6, you're updating that same README with the new attempt's Setup
content.

```sh
RUN_ID=$(basename "$RUN_DIR")
NOW=$(date +%Y-%m-%dT%H:%M:%S%:z)
cat <<EOF | memon run readme write "$RUN_ID" --project-root . --expected-mtime "$MTIME"
---
id: $RUN_ID
name: <RUN_NAME or whatever the script defaulted to>
status: RUNNING
created_at: $NOW
updated_at: $NOW
experiment: $PARENT_EXP_ID    # from §0; empty/omit if intentional orphan
finished_at: null
host: $(hostname)
pid: <captured if available>
gpus: [...]
entry: <path-relative-to-project-root, e.g. scripts/erdos/run.sh>
command: bash <path-relative-to-project-root>
wandb: <wandb-url-or-null>
---

## Setup
<env, hardware, hyperparams; per-run inputs (ckpt paths, dataset slice,
sweep param values). If the recovery loop in §11 changed anything, also
note it here so the run is reproducible.>

## Result
(pending — written when the run reaches a terminal state)

## Artifacts
- \`./run.log\` — full stdout/stderr
- \`./code.diff\` — uncommitted changes at launch (code only)
- \`./code.head\` — git HEAD at launch
- \`./checkpoints/\` — model weights (if produced)
EOF
```

**Run README schema reminders (v5):**

- Frontmatter does NOT carry `project:` / `hypotheses:` / `tags:` —
  those concerns live on the parent experiment doc.
- Frontmatter MUST carry `experiment:` (parent E-id, or `null` when
  intentionally orphan) and `updated_at:`.
- Frontmatter's `entry:` value SHALL be a path **relative to the
  project root** (NOT absolute, NOT relative to the script, NOT
  relative to the run dir). Example: `entry: scripts/erdos/run.sh`.
  This makes the field useful for reproduction (`bash <entry>` from
  the project root re-runs the script).
- Canonical body sections (v5, four total): `Motivation` (optional —
  rendered when populated) / `Setup` (required) / `Result` (required) /
  `Artifacts` (required). The web UI renders Motivation only when its
  body is non-null.
- **Forbidden on the run side**, each with a relocation destination:
  - `## Method` → fold content into the same run's `## Setup` (per-run
    methodology IS part of setup). Parser surfaces `RUN_HAS_METHOD`.
  - `## Conclusion` → fold content into the same run's `## Result`
    (per-run findings live in Result). Parser surfaces
    `RUN_HAS_CONCLUSION`.
  - `## Caveats` → relocate content to the **parent experiment doc's**
    `## Caveats`. Parser surfaces `RUN_HAS_CAVEATS`.
- The cross-run story (parent exp doc's `Motivation`, `Method`, `Plan`,
  `Conclusion`, `Caveats`, `Warnings`) gets written / updated in §0 / §9
  on the parent exp doc, NOT here.
- There is no `## New Hypotheses` section on the run README; new
  hypotheses are added to `docs/hypotheses.md` directly.
- Any non-canonical H2 heading (e.g. user-added `## Notes`) surfaces a
  `UNKNOWN_H2_SECTION` parse warning. Either rename to a canonical
  heading, drop the content, or accept the warning as intentional.

Capture the new `mtime` from the response — that's `$MTIME` for any
subsequent README write (Phase 3 periodic updates, terminal-state
finalization, etc.).

The `memon experiment link` call is NOT repeated here — it already
fired at Phase 1 in §3. If `$PARENT_EXP_ID` was empty (orphan-by-choice
in §0), this skill never linked; that's expected.

If the script was a re-run that came after recovery iterations, the
**Got it running by:** breakdown goes in this run's `## Setup` section
(under a `**Got it running by:**` paragraph). The parent experiment's
Method section gets updated separately in §9 if the recovery insight
generalizes across runs.

### 7. Periodic check (every ~120 min)

Once stably RUNNING, the agent's job isn't done — long jobs need
check-ins until terminal.

Under `/loop` dynamic mode, schedule via `ScheduleWakeup`. The runtime
clamps `delaySeconds` to ≤ 3600 (1h), so just inspect on every wake —
that's a 1h cadence, strictly more conservative than the 2h target:

```
ScheduleWakeup(
  delaySeconds: 3600,
  reason: "checking memon-run-experiment <id> at +1h",
  prompt: "<the same /loop prompt that started this skill>"
)
```

Each inspection (use shell commands liberally — see §8 below for
log-reading idioms):

1. `tail -n 50 "$RUN_LOG"` and skim for new errors / slowdowns.
2. Confirm `mtime` is still advancing (`memon show <id> --format json | jq .mtime`).
3. **GPU utilization sanity check** —
   `nvidia-smi --query-gpu=utilization.gpu --format=csv,noheader,nounits`.
   Sustained low utilization (<30% for >5 min on a job that should be
   GPU-bound) signals trouble:
   - **Early stage** (before the first training step completes) —
     strongly consider killing and restarting via the recovery loop in
     §11. Most early-stage low-GPU is dataloader hangs, OOM-then-CPU
     fallback, or wrong device placement.
   - **Mid-run** — drop a NOTE flagging it; surface to the user. Don't
     auto-kill; some workloads are legitimately bursty.
4. If healthy and unchanged → no noise; skip the NOTE unless there's
   something the user would want to see.
5. If crashed / stalled → §10.
6. If FINISHED → §9.

When NOT invoked via `/loop`, you can't self-pace. Tell the user:
"the run is RUNNING; ping me again or invoke `/loop /memon-run-experiment <id>`
if you want me to check in every ~2h automatically."

### 8. Reading `run.log` — useful shell idioms

Don't just dump the entire log. Use targeted reads:

```sh
# Last 100 lines (default for "what's happening now")
tail -n 100 "$RUN_LOG"

# Errors / exceptions / tracebacks (first 20)
grep -in 'error\|exception\|traceback\|cuda out of memory' "$RUN_LOG" | head -20

# Extract a Python traceback (first one)
awk '/Traceback \(most recent call last\):/,/^[A-Z][A-Za-z]*Error: |^[A-Z][A-Za-z]*Exception: /' "$RUN_LOG" | head -50

# Per-step throughput / loss dynamics
grep -E 'step [0-9]+|iter [0-9]+|loss' "$RUN_LOG" | tail -30

# Sanity — log size
wc -l "$RUN_LOG"; ls -lh "$RUN_LOG"

# Live tail for a fixed duration
timeout 30 tail -F "$RUN_LOG"
```

When a run crashes, the right diagnostic call is usually:
`tail -n 200 "$RUN_LOG" | grep -B2 -A20 -i 'traceback\|error'`
to pull the failure context with surrounding lines.

### 9. Terminal — success path (FINISHED)

Read fresh `MTIME`. Write the final run README updating
`status: FINISHED`, filling `## Result`, and bumping `updated_at`. Same
write pattern as §6 (the run README has only Setup/Result/Artifacts).

The cross-run story (`Conclusion`, updates to `Caveats`, possible
`Warnings`) lives on the parent experiment doc at
`<projectRoot>/docs/experiments/$PARENT_EXP_ID.md`. Update that file too
if this run's result changes the conclusion drawn across the experiment:

```sh
# Read current exp doc (mtime + content), edit, write back. The CLI for
# experiment-doc edits is `memon experiment readme write` (parallel to
# `memon run readme write`). For ad-hoc agent-driven edits, prefer the
# web markdown editor or stdin-piped CLI write — same mtime-lock contract.
```

If the recovery loop (§11) was triggered, the **`Got it running by:`**
breakdown belongs **inside this run's `## Setup` section** (next to the
hyperparam block — it's a per-run mechanical note). Don't gloss it as
"fixed some bugs"; list each meaningful change. If a change has
implications for how the result should be read (e.g. batch size halved →
effective LR halved too), also add a line to the parent experiment's
`## Caveats` so the next reader sees it across the run set.

After the README write succeeds, run **§12 (post-run anomaly review)** —
inspect the run for things the human should adjudicate and append
`[OPEN]` warnings to the parent exp doc's `## Warnings` table. Then
**walk through the run's contents in Chinese in the conversation** —
keeps the run README authoritative-and-English while the user gets the
gist without re-reading it. Cover:

- 改动了什么(对应 `**Got it running by**:`,如果有,在这个 run 的 Setup 里)
- 主要结果是什么(对应 run 的 `## Result`)
- 这一 run 学到了什么 → 如果是跨 run 已经能下的结论(同方向证据 ≥2 run),写进 exp doc 的 `## Conclusion`;否则放进对应 `## Plan` task 下面作为反思 sub-bullet,等多 run 攒够再 promote
- 对应的 Plan task 如果做完了,把 `- [ ]` 改成 `- [x]`(就改这一条,不动其他)
- 实现思路 / 设计 rationale 如果泛化到整个 experiment,追加到 exp doc 的 `## Method`
- 让用户注意的细节 / 解读限制(对应 exp doc 的 `## Caveats` 追加)
- 添加的警告(if §12 added any),让用户知道有哪几条需要他们裁决

Every cross-run insight has a deterministic home:

- **Reproducible mechanical changes that made the run launch** → this
  run's `## Setup` (`**Got it running by**:` paragraph).
- **Per-run observation, not yet a defensible cross-run pattern** → a
  reflection sub-bullet under the relevant `## Plan` task on the exp doc.
- **Defensible cross-run conclusion** (consistent evidence from ≥2 runs)
  → exp doc's `## Conclusion`.
- **Methodology refinement that applies across the experiment** → exp
  doc's `## Method`.
- **Cross-run interpretation limit** → exp doc's `## Caveats`.
- **Anomaly the human should adjudicate** → exp doc's `## Warnings`
  (via §12's post-run review).
- **Cross-cutting observation that doesn't belong to any single
  experiment** → `docs/journal.md` as a `[NOTE]` event (e.g. "memory
  leaks above 32B context on this box" — applies project-wide).

Plan is the default for per-run learnings; journal-NOTE is the fallback
for the genuinely cross-experiment case.

Brief — 3-6 lines is plenty.

#### Consider FINISHED?

After updating the exp doc, check three signals:

1. Every `- [ ]` in `## Plan` is now `- [x]` (the plan is done).
2. Every member run in the exp's `runs[]` is in a terminal state
   (`FINISHED` or `FAILED`, no `RUNNING` or `PENDING`).
3. `## Conclusion` is non-empty (the cross-run finding is on disk).

If all three hold, surface to the user (in Chinese):

> 这个 experiment 看起来可以收尾了(Plan 全勾 / 所有 run 都终止 /
> Conclusion 有内容)。要不要把它标成 FINISHED?

This is a *signal*, not an auto-promote. The user's `yes` is the actual
transition trigger; the agent SHALL NOT call any status-set CLI without
that confirmation.

### 10. Terminal — failure path (FAILED)

Branch on **whether Phase 1 (§3) wrote a README**. This is almost
always yes — Phase 1 fires as soon as proof-of-life is established,
so the only way to land in §10b is if the script crashed before
emitting `[memon] RUN_DIR=...` OR never produced any log output within
the proof-of-life wait window.

- **§10a — Phase 1 README exists (dominant path)**: flip status to
  FAILED via mtime-locked update; append a one-line reason in
  `## Result`. This covers the vast majority of failures, including
  crashes inside §5's stability window (since Phase 1 already wrote
  the README) and any mid-run / late-run crash.
- **§10b — Phase 1 never fired (rare edge)**: the script crashed
  before proof-of-life (no `[memon]` lines OR no log output). The run
  dir may or may not exist on disk; in either case the agent must
  construct a regex-conforming run dir manually (per `^.+-\d{6}-\d{6}$`)
  and write a FAILED README from scratch.

Always grep a one-line reason out of `run.log` first (used in either
branch's body):

```sh
REASON=$(tail -n 50 "$RUN_LOG" | grep -iE 'error|exception|traceback' | tail -1)
```

#### 10a. Phase 1 README exists (`$MTIME` defined)

```sh
memon run status set "$RUN_ID" --project-root . --to FAILED \
  --expected-mtime "$MTIME"
# Capture the new mtime returned by `status set` for the README append below.
MTIME=$(memon show "$RUN_ID" --project-root . --format json | jq -r .mtime)
```

The `status set` alone is sometimes enough — the Phase 1 README from
§3 already names the run + binds it to the parent experiment. To also
record the failure reason inline (and to expand Setup if §6 had a
chance to run), write the README with the fresh `$MTIME`:

```sh
cat <<EOF | memon run readme write "$RUN_ID" --project-root . \
  --expected-mtime "$MTIME"
---
... (preserved frontmatter, status: FAILED, finished_at: now,
     updated_at: now, experiment: $PARENT_EXP_ID)
---

## Setup
<preserved from §6>

## Result
Failed: <one-line reason from run.log; e.g. "OOM at batch=16 with 80GB GPU">

See \`./run.log\` for the full stack trace.

## Artifacts
<preserved from §6>
EOF
```

#### 10b. Phase 1 never fired — rare edge case

Phase 1 from §3 did NOT fire. Either the script crashed before
emitting `[memon] RUN_DIR=...` (no run-dir path on hand) or the
proof-of-life log check timed out (run dir created but `run.log` empty
within the wait window). In both cases there's no Phase 1 README on
disk, so `status set` would fail.

The agent SHALL construct a regex-conforming run dir manually (basename
matching `^.+-\d{6}-\d{6}$`, per the Anti-patterns rule — non-matching
names get silently dropped by memon discovery), then write a minimal
FAILED README from scratch:

```sh
RUN_ID=$(basename "$RUN_DIR")
NOW=$(date +%Y-%m-%dT%H:%M:%S%:z)
cat <<EOF | memon run readme write "$RUN_ID" --project-root . \
  --expected-mtime 0
---
id: $RUN_ID
name: <RUN_NAME the script chose>
status: FAILED
created_at: $NOW
updated_at: $NOW
experiment: $PARENT_EXP_ID    # from §0; empty if intentional orphan
finished_at: $NOW
host: $(hostname)
entry: <path-relative-to-project-root, e.g. scripts/erdos/run.sh>
command: bash <path-relative-to-project-root>
wandb: null
---

## Setup
<env, hardware, hyperparams that were attempted before the early crash>

## Result
Failed before reaching stable RUNNING: $REASON

See \`./run.log\` for the full stack trace.

## Artifacts
- \`./run.log\` — full stdout/stderr (may be partial)
- \`./code.diff\` — uncommitted changes at launch
- \`./code.head\` — git HEAD at launch
EOF
```

After the README is written and the run dir is registered, also bind
to the parent experiment (skip when orphan by choice):

```sh
memon experiment link "$PARENT_EXP_ID" "$RUN_ID" --project-root .
```

`--expected-mtime 0` is the sentinel for "first write to a missing
README"; the CLI will create the file. No prior `status: RUNNING` ever
existed on disk, so the JOURNAL gets a single `[STATUS]` event going
`UNKNOWN → FAILED` (or whatever the spec says for the missing-prior
case — does NOT skip the journal entry).

**Don't propose archiving the failed run.** The user reviews failed
runs in the web UI and archives them there at their own pace. Your job
is to mark FAILED + leave a one-line reason; not to clean up the list.

After the FAILED README is on disk, run **§12 (post-run anomaly
review)** as well — failures often reveal anomalies (config drift, an
infra blip that explains the crash) that the human should adjudicate
even though the run didn't reach `## Result`.

### 11. Recovery loop — make it run

When the script fails early (OOM, missing dep, traceback in the first
30s, etc.), don't give up. **Read the error log and try the obvious
fixes within your ability**:

1. Use the §8 idioms to extract the failure reason from `run.log`.
2. Diagnose:
   - OOM → reduce `BS`, gradient accumulation steps, fp16/bf16, etc.
   - Missing dep → check `pip list`, propose install (ask user before
     mutating env beyond the run).
   - Wrong path / file-not-found → fix the env var or sibling path.
   - Traceback in repo source → if it's an obvious typo / API
     mismatch, patch and retry. If it's a real algorithmic bug, surface
     to the user.
3. Apply the fix. If it requires editing the script, hand off to
   `memon-write-script`.
4. **Mark the previous attempt as `FAILED`** via §10's flow — pick §10a
   if §6 had already written a README for that attempt, §10b if it
   hadn't (early crash). Do this **before** the re-invoke, so the
   prior run dir gets a definitive terminal state instead of dangling
   as PENDING/UNKNOWN. Don't archive — user does that on the web.
5. **Re-invoke the script.** A new timestamp = a fresh run dir
   automatically. Loop back to §1 (capture fresh `code.diff` including
   your fix).
6. Repeat until you have a stably-RUNNING (or successfully FINISHED) run.

**Keep a running mental log of every change** across these iterations —
it's required input for §9's `**Got it running by**:` paragraph.

If a fix attempt is **outside your ability** (algorithmic bug,
multi-day environment change, GPU not available, …), stop iterating
and surface to the user with: a) the failure reason, b) what you tried,
c) what you'd need from them.

### 12. Post-run anomaly review — propose `[OPEN]` warnings

After the terminal-state README is written (success path §9 or failure
path §10), and **before** you walk the user through the run in Chinese,
inspect the run for anomalies that need a human to look at. These are
written into the **parent experiment doc's** `## Warnings` table as new
`[OPEN]` rows, with the `Run` column attributing each row to this run.

The Warnings section is the canonical surface for "I noticed something
the human should adjudicate". It is NOT for facts you already wrote
into `## Result`, hypotheses you yourself can confirm, or items the
user already named in the parent experiment's `## Caveats`.

`## Warnings` is distinct from `## Plan` reflections. Plan reflections
(added in §9's walkthrough) capture per-run learnings the agent is
processing toward an eventual Conclusion. Warnings (added here in §12)
flag anomalies the human MUST adjudicate. Same run, different surfaces;
this skill writes to Warnings only.

#### What qualifies as a warning

Append a warning when, while reviewing `run.log`, wandb, loss curves,
or any artifact the run produced, you observe one of:

- **methodology** — possible flaw in the experimental method (no seed
  was set, evaluation is on the train split, etc.)
- **result** — anomalous metric (loss spike, NaN gradient, accuracy
  far above/below the baseline with no obvious reason)
- **config** — config drifts from the paper / baseline / referenced
  hypothesis in a way that affects interpretation
- **data** — dataset / preprocessing concern (suspected leakage,
  unbalanced split, surprising token counts)
- **repro** — reproducibility risk (jit cache reused, version pinning
  missing, code.diff included unrelated edits)
- **compare** — baseline comparison drift (baseline ran 50 epochs,
  this only ran 30; or the baseline used a different eval suite)
- **infra** — hardware / environment noise (a GPU blipped mid-run,
  the host changed, OOM caused a partial restart)
- **other** — escape hatch when none of the above fits

Each finding goes in as **one row, one sentence**. Use the closed enum
above as `--category`. The message must be concrete (cite step / metric
/ artifact) so the human can reproduce the observation.

#### Anti-patterns — don't flag these as warnings

- ❌ Things you already wrote into `## Result` or `## Conclusion` —
  the user reads those.
- ❌ Anything the user already named in `## Caveats` — that's
  intentional limitation, not an anomaly.
- ❌ Restating the failure reason on a FAILED run — `## Result`
  already has it.
- ❌ "Every minor info note" — if the observation could go in
  `docs/journal.md` as a `[NOTE]` event, do that instead.
- ❌ Anything that's purely an implementation detail (typo fixed in
  the recovery loop, wandb logged a deprecation warning).

#### Workflow

For each finding, use the convenience CLI which auto-resolves the
parent experiment from the run dir (refuses with `BAD_STATE` if the
run is orphan — but at this point the run is bound, set in §0/§6):

```sh
memon run warning add "$RUN_ID" --project-root . \
  --category result \
  --message "loss curve at step 1500 has a 3x spike — possible gradient explosion not seen in baseline runs"
```

Equivalent long form when you have `$PARENT_EXP_ID` already in scope:

```sh
memon experiment warning add "$PARENT_EXP_ID" --project-root . \
  --run "$RUN_ID" \
  --category result \
  --message "..."
```

Both produce byte-identical stdout JSON + journal events.

The CLI returns `{ok, rowId, mtime, hash}`. **Capture the new mtime**
and use it as `--expected-mtime` for any subsequent README write in
this terminal step (warning add / status set / readme write all share
the same lock against `<runDir>/README.md`).

On exit 9 `CONFLICT`, refresh mtime via `memon show --format json`,
re-apply, retry once; on the second conflict surface to the user.

When you walk the user through the run in Chinese (§9), include a
short bullet for each warning you appended:
> 警告:loss 在 step 1500 突然飙到 3 倍,需要你看一下是不是梯度爆炸

#### What you MUST NOT do

You may **only** call `memon experiment warning add`. You SHALL NOT
call `memon experiment warning resolve`, `... reopen`, or
`... delete` under any circumstance — those are human-only acts. Even
if the user says in conversation "this warning is resolved", point them
at the web UI (or have them type the CLI themselves); don't run the
state change yourself.

## Conflict-handling protocol (mtime locking)

Every write to README.md MUST carry `--expected-mtime`. After every
successful write, **capture the returned `mtime`** from the JSON
response and use it as `--expected-mtime` for the next write.

```
read fresh mtime
attempt write
on exit 9 (CONFLICT):
  read fresh mtime (the conflict response also leaks current content on stdout)
  re-merge intent if a human edited concurrently
  retry once; if still conflicting, surface to the user
```

Never use `--force` style overrides without telling the user —
concurrent edits usually mean a human or another agent has something we
shouldn't silently throw away.

## Network / auth failures, don't loop forever

When wandb / huggingface / pip / any external service refuses to
connect or auth, stop after one diagnostic attempt:

- ❌ retrying with exponential backoff for hours
- ❌ falling back to `WANDB_MODE=offline` to "make it work"
- ❌ swallowing the error and continuing the run silently

Right behaviour:
- ✅ run one quick diagnostic (`curl -I`, `wandb login --verify`)
- ✅ summarize the symptom + diagnosis in conversation
- ✅ ask the user to fix the credential / network access
  (e.g. "claude code 容器里没开放外网访问,需要你 yolo 一下")
- ✅ pause; resume the run only after the user fixes the underlying issue

## Anti-patterns

- ❌ Tracking `PROJECT_ROOT` / `LOGS_DIR` in this skill — those are the
  script's concern. Find `RUN_DIR` from the script's output instead.
- ❌ Always passing `RUN_NAME` — leave the default unless you're doing
  a sweep where each iteration needs a distinct slug.
- ❌ Pre-setting `RUN_DIR` from this skill — that's reserved for the
  resume case.
- ❌ Skipping the Phase 1 first README write at §3. A run dir on disk
  without a README and without `memon experiment link` is how runs get
  lost — not in discovery (no README to identify it as run-bearing),
  not in the parent exp's `runs[]` either. Phase 1 IS the linkage; do
  it as soon as the script reaches proof-of-life (run dir + log
  content), not after stable RUNNING.
- ❌ Calling `memon experiment link` only at terminal state (or
  deferring it past Phase 1). The link must fire at Phase 1 in §3 —
  locking the run ↔ exp binding while the run is still alive is the
  whole point of writing the README early.
- ❌ Writing the FULL Setup body in the Phase 1 README. Phase 1 is
  intentionally minimal (placeholder Setup); the full content lands in
  the Phase 2 expansion at §6 once stable RUNNING is confirmed.
- ❌ Setting `FINISHED` without filling `## Result`.
- ❌ Setting `FAILED` without leaving a 1-line note in `## Result`.
- ❌ Naming a failed run's dir something that doesn't match
  `^.+-\d{6}-\d{6}$` — memon discovery silently skips it, the
  failure record gets dropped.
- ❌ Writing `## Method` content on a run README — fold the
  methodology refinement into this run's `## Setup` instead. The
  parser surfaces `RUN_HAS_METHOD` if you leave a Method heading on
  the run side; the web UI does NOT render a Method card on run pages.
- ❌ Writing `## Conclusion` content on a run README — the per-run
  finding belongs in `## Result`. The parser surfaces
  `RUN_HAS_CONCLUSION`; the web UI does NOT render a Conclusion card
  on run pages. (Cross-run conclusions live on the parent exp doc's
  `## Conclusion`, written via §9.)
- ❌ Writing `## Caveats` content on a run README — Caveats is a
  cross-run interpretation note that lives on the parent exp doc's
  `## Caveats`, not on individual run READMEs. The parser surfaces
  `RUN_HAS_CAVEATS`; the web UI does NOT render a Caveats card.
- ❌ Writing `entry:` as an absolute path or a path relative to the
  script. The field SHALL be relative to the project root (so
  `bash <entry>` from the project root re-runs the script). Example:
  `entry: scripts/erdos/run.sh`.
- ❌ Leaving status `RUNNING` after the script returns.
- ❌ **Proposing to archive failed runs.** User does that on the web.
- ❌ Glossing over a recovery loop. If you had to change anything to
  make the script run, the final README's `## Method` MUST include the
  `**Got it running by**:` paragraph.
- ❌ Not checking in on long jobs. A 12-hour training run can quietly
  diverge in hour 3.
- ❌ Skipping `code.diff` capture. Reproducibility-after-the-fact lives
  or dies on this pre-launch snapshot.
- ❌ Falling back to `WANDB_MODE=offline` to dodge a network/auth issue.
- ❌ Calling `memon experiment warning resolve|reopen|delete`. Those
  are **human-only acts**. This skill may only call
  `memon experiment warning add` (post-run review §12). State changes
  and deletion happen via the web UI or a human-typed CLI call.
- ❌ Skipping §12. A successful run with no warnings is fine — but the
  agent SHOULD have looked. "I noticed nothing worth flagging" is a
  valid §12 outcome; "I never reviewed" is not.

## Migration helpers (legacy projects only)

The body of this skill assumes the project's on-disk schema matches
what the current memon expects. The preflight (§"Preflight — FS
convention version") catches projects that don't and routes the
agent here.

### When the preflight reports `behind`

The project root was installed at an older convention version than
the running memon supports. Concretely on disk this means missing
the `docs/experiments/` directory, run READMEs still carrying
legacy `project:` / `hypotheses:` / `tags:` frontmatter fields,
hypotheses with `Experiments:` listing run dir names instead of
exp ids, etc.

**Do NOT try to drive `memon-run-experiment` on a `behind` project.**
The §0 step (Identify or create the parent experiment doc) assumes
`docs/experiments/` exists; the §6 README write assumes the v3
frontmatter shape; §12 assumes `## Warnings` lives on the exp doc.
Each of those will fail or write malformed output if the migration
hasn't run.

Instead, **stop and ask the user (in Chinese)** something like:

> 这个项目还在旧版本的 memon FS convention（`memon fs-version
> check` 报 `behind`）。要先跑一次 `memon-migrate-fs` skill 才
> 能走完整的 run-experiment 流程。要不要现在就开始迁移？
>
> （如果用户同意）我会调用 `memon-migrate-fs`，按照
> `packages/core/migrations/v<N>-to-v<N+1>.md` 的步骤
> 一步步迁，每一步都会等你确认。需要的话我可以先把当前
> 项目状态告诉你（多少 run、多少 hypotheses、有没有
> `docs/experiments/`），让你判断要不要这个时机做。

If the user agrees, hand off to `memon-migrate-fs` (the migration
guide is human-readable; the skill walks the steps with the user
confirming clusters / final-shape decisions). When the migration
finishes (preflight reports `match`), come back to
`memon-run-experiment` and start at §0.

If the user declines (e.g. "later, just record this run somewhere
quick"), you have two choices and BOTH require the user's explicit
buy-in:

- Drop the formal flow and use `memon-append-journal --tag NOTE
  --body "<observation>"` to record the result without producing
  any structured run README.
- Walk the user through a manual one-off README write that adheres
  to the v2 shape they already have. Tell them this is a one-off,
  the next time we run an experiment we will need to migrate.

### When the preflight reports `uninitialised`

The project root has never had memon installed. Run
`memon install-skills --project-root .` first (or ask the user to);
that creates `.memon/version.json` at the current convention
version. Then come back to §0.

### When the preflight reports `ahead`

This memon binary is older than the project's on-disk shape. The
preflight already exited 11 (`MEMON_TOO_OLD`); forward the message
to the user and tell them to upgrade the memon CLI before retrying.

### Anti-patterns specific to migration

- ❌ Patching individual files by hand to "look like v3" without
  running the migration skill. The migration touches every run
  README + hypotheses doc + journal in lockstep; partial migration
  by hand leaves dangling references.
- ❌ Migrating without telling the user. Migrations are
  irreversible-without-git-revert and involve clustering decisions
  only the user can answer (which runs share an investigation).
  Always ask before starting.
- ❌ Migrating then immediately starting a new run in the same
  session. Let the user verify the migrated layout first; the
  follow-up run is a separate decision.
