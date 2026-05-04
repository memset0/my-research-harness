---
name: memon-run-experiment
description: Run an existing launcher script (optionally with hyperparameter env-var overrides), watch it through stable RUNNING, then finalize the run's README on terminal state. The script handles its own run dir + initial README; this skill drives the lifecycle around it and iterates through fixes when the script doesn't run cleanly.
argument-hint: <script path + optional env vars; or experiment description>
disable-model-invocation: true
license: MIT
metadata:
  author: memset0
  version: "0.3.0"
---

# memon-run-experiment

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

1. Capture `code.diff` (uncommitted changes vs HEAD, filtered).
2. Wandb pre-flight if applicable.
3. Launch the script (sync or in `tmux`). The script handles its own
   `RUN_DIR` derivation, run-dir creation, initial-README write, and
   log piping — those concerns belong to the script, not this skill.
4. Detect the run dir from the script's early output, deposit
   `code.diff` + `code.head` into it.
5. Wait for stable RUNNING (~60s of growing log, no immediate crash).
6. Update the README with full Motivation / Setup / Method (still
   `status: RUNNING`).
7. Periodic check every ~120 min until terminal state.
8. On `FINISHED` → final README write with Result / Conclusion + brief
   Chinese walkthrough in conversation.
9. On `FAILED` → minimal README with 1-line failure note in Result.
10. Recovery: when the script doesn't launch cleanly, **iterate inside
    the agent's ability** — read the error log, apply fixes, re-launch
    — until it runs. Document every change in the final README's
    Method section.

You are the **agent that owns the README's full content** for this run.
The script writes only the frontmatter; sections come from this skill.

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

### 1. Pre-launch — capture `code.diff` + wandb pre-flight

```sh
TMP_DIFF=$(mktemp)
TMP_HEAD=$(mktemp)
git rev-parse HEAD > "$TMP_HEAD" 2>/dev/null || true
git diff HEAD -- \
    ':(exclude,glob)**/*.md'   ':(exclude,glob)**/*.log' \
    ':(exclude,glob)**/*.json' ':(exclude,glob)**/*.jsonl' \
    ':(exclude,glob)**/*.txt'  ':(exclude,glob)**/*.csv' \
    ':(exclude,glob)**/*.png'  ':(exclude,glob)**/*.jpg' \
    ':(exclude,glob)**/*.jpeg' ':(exclude,glob)**/*.gif' \
    ':(exclude,glob)**/*.pdf'  ':(exclude,glob)**/*.zip' \
    ':(exclude,glob)**/*.tar'  ':(exclude,glob)**/*.gz' \
    ':(exclude,glob)**/*.bin'  ':(exclude,glob)**/*.pt' \
    ':(exclude,glob)**/*.pth'  ':(exclude,glob)**/*.ckpt' \
    ':(exclude,glob)**/*.safetensors' \
    ':(exclude,glob)**/*.npy'  ':(exclude,glob)**/*.npz' \
    ':(exclude,glob)**/*.parquet' ':(exclude,glob)**/*.h5' \
    ':(exclude,glob)**/*.hdf5' ':(exclude,glob)**/*.pkl' \
    ':(exclude,glob)**/*.pickle' \
    > "$TMP_DIFF" 2>/dev/null || true
```

**Wandb pre-flight**: if the script imports `wandb` (grep the script and
any sibling `.py` it sources), the run is **wandb-tracked** and must
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
  `RUN_DIR` with a fresh timestamp, creates it, and writes a new
  `run.log` + `README.md`.
- **Resume** (the user pointed at a specific existing run dir, OR a
  previous run crashed and we want to continue rather than start over):
  pre-set `RUN_DIR` so the script reuses that dir.

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
   triggering a CONFLICT in §4.
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

### 4. Drop in code snapshots + write (or update) the README

The script only `mkdir`s `$RUN_DIR` — it does NOT write `README.md`.
That's this skill's job. Move the snapshots in, then write the README
with full Motivation / Setup / Method (status: RUNNING).

**Fresh launch**: README doesn't exist yet. Use `--expected-mtime 0`
(the CLI treats `0` as a sentinel for "first write to a missing
README"). Code snapshots go in as plain `code.diff` + `code.head`.

**Resume**: README probably already exists from the prior run. Read its
current `mtime` and content first; merge your new Motivation/Setup/Method
context with whatever's already there (or just re-set status to RUNNING
if the prior README is fine), then write back with that mtime as
`--expected-mtime`. Code snapshots go in as `code.diff.<resume-iso>` +
`code.head.<resume-iso>` so prior snapshots are preserved.

```sh
mv "$TMP_DIFF" "$RUN_DIR/code.diff"        # or code.diff.<resume-ts> on resume
mv "$TMP_HEAD" "$RUN_DIR/code.head"        # or code.head.<resume-ts> on resume

EXP_ID=$(basename "$RUN_DIR")
# Fresh: --expected-mtime 0
# Resume: --expected-mtime "$EXISTING_MTIME"  (read via `memon show $EXP_ID --format json`)
cat <<EOF | memon experiment readme write "$EXP_ID" --project-root . --expected-mtime "$MTIME"
---
id: $EXP_ID
name: <RUN_NAME or whatever the script defaulted to>
project: <project>
status: RUNNING
created_at: $(date -Iseconds)
finished_at: null
host: $(hostname)
pid: <captured if available>
gpus: [...]
entry: <script-relative-path>
command: bash <script-relative-path>
hypotheses: [H3]
tags: [...]
---

## Motivation
<why this run mattered, from the user's description>

## Setup
<env, hardware, hyperparams>

## Method
<what the script does in 1-2 paragraphs; reference the script's one-line header>

## Result
(pending — written when the run reaches a terminal state)

## Conclusion
(pending)

## Caveats
<known limitations going in; will be augmented post-run if needed>

## Artifacts
- `./run.log` — full stdout/stderr
- `./code.diff` — uncommitted changes at launch (code only)
- `./code.head` — git HEAD at launch
- `./checkpoints/` — model weights (if produced)
EOF
```

Capture the new `mtime` from the response — that's `$MTIME` for any
subsequent README write (terminal-state finalization, etc.).

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
already exited), skip to §9 (Failed path).

### 6. Periodic check (every ~120 min)

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

Each inspection (use shell commands liberally — see §7 below for
log-reading idioms):

1. `tail -n 50 "$RUN_LOG"` and skim for new errors / slowdowns.
2. Confirm `mtime` is still advancing (`memon show <id> --format json | jq .mtime`).
3. **GPU utilization sanity check** —
   `nvidia-smi --query-gpu=utilization.gpu --format=csv,noheader,nounits`.
   Sustained low utilization (<30% for >5 min on a job that should be
   GPU-bound) signals trouble:
   - **Early stage** (before the first training step completes) —
     strongly consider killing and restarting via the recovery loop in
     §10. Most early-stage low-GPU is dataloader hangs, OOM-then-CPU
     fallback, or wrong device placement.
   - **Mid-run** — drop a NOTE flagging it; surface to the user. Don't
     auto-kill; some workloads are legitimately bursty.
4. If healthy and unchanged → no noise; skip the NOTE unless there's
   something the user would want to see.
5. If crashed / stalled → §9.
6. If FINISHED → §8.

When NOT invoked via `/loop`, you can't self-pace. Tell the user:
"the run is RUNNING; ping me again or invoke `/loop /memon-run-experiment <id>`
if you want me to check in every ~2h automatically."

### 7. Reading `run.log` — useful shell idioms

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

### 8. Terminal — success path (FINISHED)

Read fresh `MTIME`. Write the final README updating `status: FINISHED`
and filling Result + Conclusion. Same write pattern as §4.

If the recovery loop (§10) was triggered, the `## Method` section MUST
include a `**Got it running by**:` paragraph listing every change that
made the script work. Don't gloss it as "fixed some bugs"; list each
meaningful change. If a change has implications for how the result
should be read (e.g. batch size halved → effective LR halved too), also
add a line to `## Caveats`.

After the README write succeeds, **walk through its contents in Chinese
in the conversation** — keeps the README authoritative-and-English while
the user gets the gist without re-reading it. Cover:

- 改动了什么(对应 `**Got it running by**:`,如果有)
- 主要结果是什么(对应 `## Result`)
- 结论是什么 / 怎么影响关联的假说(对应 `## Conclusion`)
- 有什么坑 / 解读时需要注意的限制(对应 `## Caveats`)
- 实现思路或想让用户注意的细节,如果 README 里没合适的位置写

Brief — 3-6 lines is plenty.

### 9. Terminal — failure path (FAILED)

If `EXIT != 0` (or §6 inspection saw a crash):

```sh
memon experiment status set "$EXP_ID" --project-root . --to FAILED \
  --expected-mtime "$MTIME"
```

Capture the new mtime, then write a minimal README. Use the shell
idioms in §7 to extract a one-line failure reason from `run.log`:

```sh
REASON=$(tail -n 50 "$RUN_LOG" | grep -iE 'error|exception|traceback' | tail -1)
```

```sh
cat <<EOF | memon experiment readme write "$EXP_ID" --project-root . \
  --expected-mtime "$NEW_MTIME"
---
... (preserved frontmatter, status: FAILED, finished_at: now)
---

## Result
Failed: <one-line reason from run.log; e.g. "OOM at batch=16 with 80GB GPU">

See \`./run.log\` for the full stack trace.
EOF
```

**Don't propose archiving the failed run.** The user reviews failed
runs in the web UI and archives them there at their own pace. Your job
is to mark FAILED + leave a one-line reason; not to clean up the list.

### 10. Recovery loop — make it run

When the script fails early (OOM, missing dep, traceback in the first
30s, etc.), don't give up. **Read the error log and try the obvious
fixes within your ability**:

1. Use the §7 idioms to extract the failure reason from `run.log`.
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
4. **Re-invoke the script.** A new timestamp = a fresh run dir
   automatically. Loop back to §1 (capture fresh `code.diff` including
   your fix).
5. Mark the previous attempt's status as `FAILED` via §9's flow (with
   a one-line reason). Don't archive — user does that on the web.
6. Repeat until you have a stably-RUNNING (or successfully FINISHED) run.

**Keep a running mental log of every change** across these iterations —
it's required input for §8's `**Got it running by**:` paragraph.

If a fix attempt is **outside your ability** (algorithmic bug,
multi-day environment change, GPU not available, …), stop iterating
and surface to the user with: a) the failure reason, b) what you tried,
c) what you'd need from them.

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
- ❌ Writing the full README before the run is stably RUNNING (§5).
- ❌ Setting `FINISHED` without filling `## Result`.
- ❌ Setting `FAILED` without leaving a 1-line note in `## Result`.
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
