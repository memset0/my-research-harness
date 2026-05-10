---
name: memon-propose
description: Brainstorm next experiments for a memon project — diverge into 5-8 candidates grounded in HYPOTHESES + recent experiments + open JOURNAL requests, then converge to the 1-3 strongest. Read-only research collaborator; does not scaffold or execute.
argument-hint: <optional theme, hypothesis id, or constraint to focus the proposals>
disable-model-invocation: true
license: MIT
metadata:
  author: memset0
  version: "0.2.0"
---

# memon-propose

Read-only **research collaborator**. The job is not "pick the safest
next ticket" — it's to be a useful brainstorming partner for an ML/
systems researcher. Diverge first (lots of candidates, including
unconventional ones), then converge to the strongest 1-3 with
rationale + trade-offs.

Looks at:

1. `docs/hypotheses.md` — open / partial / refuted hypotheses (refuted ones
   may suggest *adjacent* experiments, not just be discarded)
2. Recent experiments — what was tried, what worked, what failed, what
   the FAILED ones almost-but-didn't-quite show
3. Recent JOURNAL events — open REQUESTs from the user, NOTEs flagging
   surprising observations
4. Recent digests / reports if any (`docs/digests/`, `docs/reports/`)
   for the synthesized narrative the user has been building

Then runs a **two-phase** proposal:

- **Diverge**: 5-8 candidate experiments, each one paragraph. Don't
  filter early — include "obvious" candidates AND a couple of weirder
  ones (orthogonal axes, ablations, negative-result probes,
  what-would-falsify-this-cheaply ideas). Variance in a brainstorm is
  a feature.
- **Converge**: 1-3 strongest proposals, each with full motivation +
  sketch + trade-offs vs. the alternatives.

**This skill never writes anything to disk.** The user reads the
proposals and decides which (if any) to pursue.

## Preflight — FS convention version

Run `memon fs-version check --project-root . --format json` as the first
step. If `status !== "match"`, STOP and follow the branch protocol in
`../PREFLIGHT.md` (covers `match` / `behind` / `uninitialised` / `ahead`).

## When to use

- The user asks "what should I run next?"
- A hypothesis is `OPEN` or `PARTIAL` and the user wants candidate probes
- The user is between experiments and wants a menu of options to react against
- A recent FAILED run hints at adjacent experiments worth running
- The user wants explicit alternatives considered + rejected, not just one recommendation

## When NOT to use

- ❌ The user already named a specific experiment to run — go straight to `memon-write-script` / `memon-run-experiment`
- ❌ For implementation help on a known direction — this skill is read-only brainstorm
- ❌ For analyzing an in-flight experiment — those are still RUNNING; check via `memon show` instead
- ❌ When the project has zero hypotheses yet — talk with the user about hypothesis seeding first

## Why brainstorm at all

Single-best-pick recommendations from an LLM are usually
boringly safe — pick the obvious next ablation, miss the experiment
that would actually change someone's mind. Researchers benefit more
from a *menu* of ideas to react against than from a single
recommendation handed down with false confidence. Show them the
losing candidates too — knowing which alternatives were considered
and why they were dropped is signal.

## Workflow

### 1. Snapshot the project

```sh
SNAPSHOT=$(memon scan --project-root "$PROJECT_ROOT")
```

The output has experiments + hypotheses + journal in one shot.

If recent digests exist, read the latest one + any reports — that's
where prior synthesis lives. Plain shell, no `memon` call needed:

```sh
LATEST_DIGEST=$(ls -t docs/digests/D*-*.md 2>/dev/null | head -1)
[ -n "$LATEST_DIGEST" ] && cat "$LATEST_DIGEST"
ls docs/reports/R*-*.md 2>/dev/null | xargs -r cat
```

Also read each relevant exp doc's `## Plan` section — `[ ]` items
there are the user's already-declared intent and act as strong priors
for the brainstorm:

```sh
for exp in $(echo "$SNAPSHOT" | jq -r '.experiments.entries[].id'); do
  echo "=== $exp ==="
  memon experiment show "$exp" --project-root . --format json \
    | jq -r '.sections.plan // empty'
done
```

### 2. Filter to live hypotheses

```sh
echo "$SNAPSHOT" \
  | jq '.hypotheses.entries[]
        | select(.status == "OPEN" or .status == "PARTIAL")'
```

For each, check:

- Is anyone currently testing it? (any RUNNING experiment with this id
  in `frontMatter.hypotheses`)
- What did past experiments find? (look at FINISHED + FAILED with this id)
- Are there obvious gaps? PARTIAL means some evidence; a clean test
  wasn't run, OR the evidence has a confound we should isolate.

Don't *only* look at OPEN/PARTIAL. A REFUTED hypothesis sometimes
suggests an adjacent re-formulation worth proposing.

### 3. Filter recent journal for context

```sh
echo "$SNAPSHOT" \
  | jq '.journal.events[]
        | select(.tag == "REQUEST" or .tag == "NOTE" or .tag == "ERROR")' \
  | head -30
```

Open REQUESTs from the human are strong signals about what to prioritize.
NOTEs sometimes contain a "huh, that's weird" observation that's worth
a probe-experiment.

### 4. Diverge — 5-8 candidates (one paragraph each)

Before proposing net-new candidates, surface any already-`[ ]`-listed
Plan items across the relevant exps as "already-planned, can be
resumed by the user" — these are strong priors. Don't re-propose
them as net-new candidates; if a proposal overlaps with an existing
Plan item, frame it explicitly as "extends Plan item E0001-foo §
'sweep bs' by …" with a clear rationale for the extension, or as
"alternative to Plan item E0001-foo § 'X' because …".

Then, for the brainstorm proper, cast a wide net. Mix of:

- **Confirmation-style** — direct probes of OPEN / PARTIAL hypotheses
- **Falsification-style** — what experiment would refute the leading
  hypothesis cheapest?
- **Adjacent / orthogonal** — same setup, change a variable nobody's
  swept yet (model size, dtype, seed, dataset slice)
- **Ablation** — remove one component of a working setup to see what
  was actually load-bearing
- **Replication / robustness** — a single data point on a key claim is
  fragile; a cheap re-run with a different seed / GPU is often very
  high-value
- **Negative-result probes** — propose the experiment whose null
  result would be informative (not just the one whose positive result
  would be exciting)
- **One unconventional / "what if"** — at least one idea that's a
  stretch but scientifically motivated

Output as a tight list. Don't sketch scripts yet — the goal is breadth
of thinking, not implementation detail.

```markdown
## Brainstorm candidates

1. **bs-sweep-bf16** — H0003 PARTIAL had only batch=8 evidence; sweep 4/8/16
   to either confirm or expose a batch dependence.
2. **lr-perturbation-fp32-control** — H0003 evidence might be a bf16
   artifact; rerun the strongest run in fp32 as a control.
3. **smaller-model-replication** — does H0003 hold at 350M params? If yes,
   it's a property of the optimization not the model — much stronger claim.
4. **seed-spread** — `bar-260502` is a single-seed result; 3 seeds at
   the same config will tell us if H0003 is reliable or a fluke.
5. **negative-control-no-warmup** — drop LR warmup; if the sparsity
   pattern survives, warmup wasn't load-bearing for the H0003 effect.
6. **fp16-vs-bf16-direct** — same setup, swap dtype only; isolates the
   numerics from the optimizer dynamics.
7. **frozen-embeddings-ablation** — freeze the embedding layer; if H0003
   still holds, the sparsity isn't an artifact of embedding-table updates.

(Aim for 5-8 total; show all of them in the brainstorm so the user can
react against the full set.)
```

### 5. Converge — 1-3 strongest with rationale + trade-offs

For each picked proposal, write the full case (markdown the user can
paste). Include **why this and not the others** — that's the part
researchers actually use. If a converged proposal overlaps with an
already-`[ ]` Plan item from §1, name that explicitly ("Plan item
E0001-foo § 'sweep bs' — this proposal extends it by …") rather
than presenting it as net-new.

````markdown
## Proposal 1: bs-sweep-bf16

**Tests**: H0003 (per-step bf16 param delta is sparse)

**Motivation**: H0003 is currently PARTIAL — `bar-260502-150000` showed
sparsity at bs=8 but didn't sweep. Current evidence is "1 data point at
1 config", which is fragile. A 3-batch sweep at fixed lr will either
upgrade H0003 to CONFIRMED or expose a batch-size dependence we'd
otherwise miss.

**Why this over the brainstorm alternatives**:

- Beats `lr-perturbation-fp32-control` (#2) because the bs-axis
  variation is what the existing H0003 evidence is most under-determined
  on; we have *zero* batch-size variance, only zero dtype variance.
- Beats `seed-spread` (#4) because seed variance is cheaper to add
  later and a batch sweep also implicitly probes seed-dependent noise
  per-config.
- Risk: 3 runs at bs=16 may OOM on the dev GPU; size-down the model
  if so or queue overnight.

**Sketch**:

```bash
# Sweep batch size 4/8/16 with bf16, log per-step Δparam histograms.
for bs in 4 8 16; do
  RUN_NAME="bs$bs" BS="$bs" bash scripts/erdos/run.sh
done
```

**Cost estimate**: ~3× a single bs=8 run (~6h on 1 H100).

**Hand off to**: `memon-write-script` (if `run.sh` doesn't exist), then
`memon-run-experiment` per setting.
````

### 6. Stop

Don't scaffold, don't write README, don't append to JOURNAL. The user
chooses one (or none) and pipes it into the next skill, or asks for a
deeper riff on one of the brainstorm items you didn't promote.

## Heuristics

- **Prefer hypotheses with status `OPEN` or `PARTIAL`** for the
  *converged* proposals; brainstorm freely across all statuses.
- **Avoid re-running already-failed setups verbatim** — check the
  FAILED experiments' Result section. But "the failed run hinted at X
  so let's try Y instead" is fair game.
- **Stale RUNNING experiments are red flags**, not next steps — surface
  them as observations, suggest the user run `memon-digest-journal`
  (which folds in doctor checks).
- **Open REQUESTs in JOURNAL trump everything** — those are the human's
  explicit asks; address one of those before suggesting net-new work,
  unless brainstorming reveals something the user clearly hasn't
  considered.
- **Don't be afraid to propose negative results / replications** —
  they're often the highest-EV move in research, and the LLM bias is
  to propose flashy positives.

## Output volume

- Brainstorm: 5-8 candidates (one paragraph each).
- Converged: 1-3 full proposals.

If you can't justify even 1 strongly-grounded converged proposal, say
so and ask the user for direction instead of inventing weak ones. The
brainstorm list is still useful in that case — show it, label it as
"low-confidence", and let the user pick.
