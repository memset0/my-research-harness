---
name: memon-run-experiment
description: Run an experiment end-to-end in a memon project — scaffold the run dir if needed, launch the script, monitor for stable RUNNING, then write README.md (or mark FAILED if it crashed). Use when the user describes an experiment they want to actually execute.
license: MIT
metadata:
  author: memon
  version: "0.1.0"
---

# memon-run-experiment

Drive an experiment from scaffold to README. You are responsible for:

1. Creating (or reusing) the run directory
2. Putting the experiment into the `RUNNING` state
3. Launching the script (synchronously, or in a `tmux` session for long jobs)
4. Once the run is **stably running** (or finished), writing README.md per
   the memon spec
5. On failure: marking status `FAILED`, leaving a one-line failure note in
   `## Result`, and offering to archive

You are the **agent that owns the README** for this run. No other skill
will fill it in retroactively — `memon-doctor` only flags missing content,
it doesn't write it.

## Inputs the user can give you

- **A specific run.sh** to execute (path)
- **A description** ("run a bf16 vs fp16 sweep on the 8B model with batch
  size 4/8/16") — in this case, first delegate script authoring to
  `memon-write-script`, then come back here to launch
- **An existing run dir** (already scaffolded, possibly already failed)

## Workflow

### 1. Resolve the project root

```
PROJECT_ROOT="${1:-$(pwd)}"
```

The skill always passes `--project-root` explicitly so it works regardless
of `config.yml`.

### 2. Scaffold (if needed)

If the user described the experiment but no run dir exists:

```sh
memon new <name> --project-root "$PROJECT_ROOT"
```

This creates `<root>/logs/<name>-yymmdd-hhmmss/` with `README.md` + `run.sh`,
status `PENDING`, and emits a `[CREATE]` JOURNAL event.

If the user wants script changes, hand off to `memon-write-script` to author
or edit `run.sh`, then continue.

### 3. Read the current README state (mtime is what you'll lock against)

```sh
EXP_JSON=$(memon show "$EXP_ID" --project-root "$PROJECT_ROOT" --format json)
MTIME=$(echo "$EXP_JSON" | jq .mtime)
```

### 4. Move to RUNNING

```sh
memon experiment status set "$EXP_ID" \
  --project-root "$PROJECT_ROOT" \
  --to RUNNING \
  --expected-mtime "$MTIME"
```

Capture the new mtime from the JSON response — you'll need it for the next
write.

### 5. Launch the script

For short scripts, run synchronously:

```sh
bash "$RUN_DIR/run.sh"
EXIT=$?
```

For long scripts, prefer `tmux` so the user can attach later (and the
browser-terminal feature picks it up):

```sh
tmux new-session -d -s "memon-claude-$EXP_ID" "bash $RUN_DIR/run.sh"
```

If you used `tmux`, don't proceed to write the README until the session is
in a stable RUNNING state (no rapid status changes, log file is growing
predictably). Tail the log for ~60 seconds before declaring stable:

```sh
tail -f "$RUN_DIR/run.log" & TAIL_PID=$!
sleep 60
kill $TAIL_PID
```

### 6a. Successful path — write the README

Read fresh mtime, then send the new content via stdin:

```sh
cat <<'EOF' | memon experiment readme write "$EXP_ID" \
  --project-root "$PROJECT_ROOT" \
  --expected-mtime "$NEW_MTIME"
---
id: $EXP_ID
name: $NAME
project: $PROJECT
status: FINISHED
created_at: ...
finished_at: ...
host: ...
gpus: [...]
entry: ./run.sh
command: bash run.sh
hypotheses: [H3]
tags: [bf16, sweep]
---

## Motivation
<why this run mattered>

## Setup
<env, hardware, hyperparams>

## Method
<what the run.sh does in 1-2 paragraphs; reference the script header>

## Result
<the actual numbers — be specific, copy from log/run.log>

## Conclusion
<1-2 sentences on what this evidence does to your hypothesis>

## Caveats
<known limitations>

## Artifacts
- `./run.log` — full stdout/stderr
- `./checkpoints/` — model weights
EOF
```

If you got back a CONFLICT (exit 9), re-`memon show`, re-write with the new
mtime. The conflict response includes the current content on stdout for
diffing.

### 6b. Failed path — minimal README + maybe archive

If `EXIT != 0`:

```sh
memon experiment status set "$EXP_ID" \
  --project-root "$PROJECT_ROOT" \
  --to FAILED \
  --expected-mtime "$MTIME"
```

Then write a minimal README — Result is the only thing the user really
wants:

```sh
cat <<EOF | memon experiment readme write "$EXP_ID" \
  --project-root "$PROJECT_ROOT" \
  --expected-mtime "$NEW_MTIME"
---
... (same front-matter as scaffold)
status: FAILED
---

## Result
Failed: <one-line reason from the last 5 lines of run.log>

See \`./run.log\` for the full stack trace.
EOF
```

**Then ask the user**: "this run failed; want me to `memon experiment
archive $EXP_ID` so it doesn't clutter `memon list`?" — if yes, do it.

### 7. Update the journal

If the run did something interesting beyond the README, drop a NOTE:

```sh
memon journal append \
  --project-root "$PROJECT_ROOT" \
  --tag NOTE --experiment-id "$EXP_ID" \
  --body "<observation that didn't fit into a section>"
```

## Conflict-handling protocol (mtime locking)

Every write to README.md MUST carry `--expected-mtime`. Skill-level
algorithm:

```
read fresh mtime
attempt write
on exit 9:
  read fresh mtime (the conflict response also leaks current content on stdout)
  re-merge intent if a human edited concurrently
  retry once; if still conflicting, surface to user
```

Never use `--force` style overrides without telling the user — concurrent
edits usually mean a human or another agent has something we shouldn't
silently throw away.

## Anti-patterns

- ❌ Writing the README before the script is stable (or at all if it
  crashed within 5 seconds — that's a config error, not an experiment)
- ❌ Setting `FINISHED` without filling in `## Result`
- ❌ Setting `FAILED` without leaving a 1-line note in `## Result`
- ❌ Leaving status `RUNNING` after the script returns
- ❌ Writing the README content in any format other than the spec'd 8 sections
