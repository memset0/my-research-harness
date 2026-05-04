---
name: memon-propose
description: Read a memon project's hypotheses + recent experiments and propose 1-3 next experiments to run, each tied to an open hypothesis. Read-only — does not scaffold or execute. Use when the user asks "what should I run next?".
argument-hint: <optional theme, hypothesis id, or constraint to focus the proposals>
disable-model-invocation: true
license: MIT
metadata:
  author: memset0
  version: "0.1.0"
---

# memon-propose

Read-only advisor. Looks at:

1. `HYPOTHESES.md` — open / partial hypotheses
2. Recent experiments — what was tried, what failed, what's pending
3. Recent JOURNAL events — open REQUESTs, recent NOTEs

Then proposes 1-3 next experiments, each with:

- A short name (kebab-case, < 30 chars, will become part of the run dir)
- The hypothesis it tests (must be an existing `H<n>`)
- Motivation — why this is the highest-value next move
- A sketch of the script (handed off to `memon-write-script` for actual authoring)

**This skill never writes anything to disk.** The user copies the proposal
and either runs `memon-write-script` + `memon-run-experiment` themselves or
asks them to chain.

## Workflow

### 1. Snapshot the project

```sh
SNAPSHOT=$(memon scan --project-root "$PROJECT_ROOT")
```

The output has experiments + hypotheses + journal in one shot.

### 2. Filter to open hypotheses

```sh
echo "$SNAPSHOT" | jq '.hypotheses.entries[] | select(.status == "OPEN" or .status == "PARTIAL")'
```

For each open hypothesis, check:

- Is anyone currently testing it? (any RUNNING experiment with this id in `frontMatter.hypotheses`)
- What did past experiments find? (look at FINISHED ones with this id)
- Are there obvious gaps? (e.g. PARTIAL means some evidence, but a clean test wasn't run)

### 3. Filter recent journal for context

```sh
echo "$SNAPSHOT" | jq '.journal.events[] | select(.tag == "REQUEST" or .tag == "NOTE")' | head -20
```

Open REQUESTs from the human are strong signals about what to prioritize.

### 4. Compose proposals

For each proposal, output (in markdown so the user can paste into a chat):

```markdown
## Proposal 1: bf16-sweep-batch-effect

**Tests**: H3 (per-step bf16 param delta is sparse)

**Motivation**: H3 is currently PARTIAL — `bar-260502-150000` showed sparsity
at batch=8 but didn't sweep. Current evidence is "1 data point at 1
config", which is fragile. A 3-batch sweep at fixed lr would either
upgrade H3 to CONFIRMED or expose a batch-size dependence we missed.

**Sketch**:
```bash
# Sweep batch size 4/8/16 with bf16, log per-step Δparam histograms.
for bs in 4 8 16; do
  python -m measure_delta --bs "$bs" --steps 100 --dtype bf16 \
    --out "$RUN_DIR/bs_$bs"
done
```

**Hand off to**: `memon-write-script`, then `memon-run-experiment`.
```

### 5. Stop

Don't scaffold, don't write README, don't append to JOURNAL. The user
chooses one (or none) and pipes it into the next skill.

## Heuristics

- **Prefer hypotheses with status `OPEN` or `PARTIAL`** — confirmed/refuted
  ones are settled
- **Avoid suggesting experiments that look like already-failed ones** —
  check the FAILED experiments' Result section
- **Stale RUNNING experiments are red flags**, not next steps — surface
  them as observations, suggest the user check on them via `memon-doctor`
- **Open REQUESTs in JOURNAL trump everything** — those are the human's
  explicit asks; address one of those before suggesting net-new work

## Output volume

1-3 proposals. If you can't justify 1 strongly-grounded proposal, say so
and ask the user for direction instead of inventing weak ones.
