---
name: memon-drive
description: Long-running conversational orchestrator for an experiment. Iterates design with the user, calls memon-write-script / memon-run-experiment as sub-tools, maintains the exp doc's Plan section, surfaces FINISHED when ready.
argument-hint: <experiment idea, or existing E-id to resume>
license: MIT
metadata:
  author: memset0
  version: "0.1.0"
---

# memon-drive

The session-level orchestrator for working on one experiment with a
user. Spans the whole lifecycle: from "I want to investigate X"
through running multiple launches, accumulating per-run learnings,
and proposing FINISHED when the cross-run picture stabilises.

`memon-drive` is an **orchestrator**, not a doer. It calls
`memon-write-script`, `memon-run-experiment`, and
`memon-write-code-review` as sub-tools, and treats the exp doc's
`## Plan` section as its working memory.
Every meaningful turn of the conversation produces either a Plan
edit, a Method/Caveats/Motivation refinement, or (when warranted)
a Conclusion update — there is no "this conversation happened but
nothing landed on disk" outcome.

## Preflight — FS convention version

Run `memon fs-version check --project-root . --format json` as the first
step. If `status !== "match"`, STOP and follow the branch protocol in
`../PREFLIGHT.md` (covers `match` / `behind` / `uninitialised` / `ahead`).

## When to use

- The user proposes a new experiment in conversation and asks you to drive it ("I want to investigate Y, let's start")
- The user names an existing exp doc with some progress and asks you to continue ("pick up E0007-bf16-numerics and keep going")
- The user has a vague idea that needs iterative design before any code lands ("X seems interesting, how would we approach this?")
- Mid-experiment, the user has new info / a new direction and wants `Plan` / `Method` / `Caveats` updated to reflect it

## When NOT to use

- ❌ A single concrete run with a known script and known inputs — go straight to `memon-run-experiment`
- ❌ Brainstorming candidate experiments across the project (vs. iterating on one) — that's `memon-propose`
- ❌ Writing a launcher script with no broader exp context — `memon-write-script` alone
- ❌ Recording one observation / one warning — `memon-append-journal` / `memon-append-warning`
- ❌ For a session that doesn't need any disk side-effects (the user just wants to talk through an idea) — don't fire `memon-drive`; talk freely

## Two entry modes

### Mode A — Start fresh

The user has an experiment idea but no exp doc yet (or only an empty
stub).

1. Discuss the idea — hypothesis, the minimum-viable first action,
   alternatives the user has already considered, what would close
   the question vs. leave it open.
2. Create the exp doc via `memon experiment create <slug> --title <T>`.
3. Populate the body based on the discussion. Section order is
   `Motivation` → `Method` → `Plan` → `Conclusion` → `Caveats` →
   `Warnings`. Initial Plan items go in as `- [ ]` tasks; Method
   stays methodology-only; Conclusion stays empty until defensible.
4. Hand the first Plan task off to the appropriate sub-skill (see §2).

### Mode B — Resume

The user names an existing exp id (`E<NNNN>-<slug>`) or asks you to
continue an exp they've been doing.

1. Read the exp doc:
   ```sh
   memon experiment show "$EXP_ID" --project-root . --format json | jq
   ```
2. Read its `## Plan` to see what's done (`[x]`) and pending (`[ ]`).
3. Read its member runs' READMEs (the `runs[]` in frontmatter, each
   one via `memon run readme show <run-id>` or `memon experiment show
   <exp-id> --include-runs`).
4. Ask the user where to pick up — the next `[ ]` task by default,
   but possibly a new task they want to insert, or a re-think of
   the existing plan.
5. Continue from §2.

## Workflow

### 0. Snapshot — which mode, what's already there

Identify Mode A vs. Mode B from the user's prompt. In both modes,
capture into the session memory: `$EXP_ID`, the parsed `## Plan`,
the list of member runs and their statuses, the current `mtime` of
the exp doc (for later optimistic writes).

### 1. Iterate the design with the user until the next step is concrete

Forward-looking work needs three things settled before any code lands:

1. **What's the next concrete action?** A single test, sweep, or
   analysis — not "investigate bf16" but "run a single bs=8 bf16
   baseline at 50k steps".
2. **What inputs/outputs?** Inputs (config / data / ckpt) and outputs
   (run dir / metrics / artifacts) defined enough to evaluate
   success vs. failure.
3. **What evidence would close this Plan item?** "Loss < 2.5 at step
   10k" closes it; "see what happens" does not.

Until those three are settled, **do not write any script or kick off
any run**. Keep iterating — ask focused questions, present
trade-offs, name alternatives. Show the user the candidate Plan-item
phrasing before adding it.

When the next action is settled, write it (or refine it) as a `- [ ]`
task item in `## Plan`. Use `memon experiment readme write` with
mtime-locked optimistic concurrency (same pattern as
`memon-run-experiment` §6).

### 2. Execute the next Plan item

#### 2a. New launcher needed → invoke `memon-write-script`

If the action requires a launcher (something that creates a run dir,
runs training/eval, emits `[memon] ...` echo lines, integrates with
the experiment lifecycle), invoke `memon-write-script` as a sub-tool.
Pass `$EXP_ID` so the new script's registration line lands in the
exp doc's `## Method`.

#### 2b. Existing launcher → invoke `memon-run-experiment`

If a launcher already exists (Mode B resume case, or 2a just
produced one), invoke `memon-run-experiment`. Pass the script path
plus any env-var overrides the Plan item specifies (e.g.
`BS=16 LR=1e-4`).

#### 2c. Inline analysis utility — DO NOT use `memon-write-script`

For data-analysis helpers — read a run's output, transform a CSV,
plot a metric, compare two runs' results — write a python file
inline and run it directly. **Do NOT route these through
`memon-write-script`**.

Decision rule: **if rerunning the script with the same input
produces the same output in seconds-to-minutes without GPU, it's
an inline analysis util.** If it touches a GPU or runs for hours,
it's a launcher and belongs in `memon-write-script`.

Where analysis utils live:

- **Default**: the exp folder itself — `<projectRoot>/docs/experiments/
  E<NNNN>-<slug>/`. v5 promoted per-experiment folders specifically for
  this kind of artifact; a `plot_loss.py` that exists to analyse one
  experiment's runs belongs inside that experiment's folder, where it
  sits next to the exp README + any launchers + ad-hoc figures.
- **Fallback**: `<projectRoot>/scripts/<area>/analysis/` for analysis
  utils that are genuinely cross-experiment (e.g. a generic
  CSV-to-figure pipeline reused everywhere).

They MAY be referenced from a Plan item's reflection sub-bullet (`ran
docs/experiments/E0007-.../plot_loss.py on run X; result saved to
/tmp/...`) but they do NOT get a `## Method` registration line —
they're tooling, not methodology.

### 3. After each Plan item: update the exp doc

After a Plan item completes (the action finished, the run reached
terminal state, the analysis produced output), update the exp doc:

- **Flip the Plan task**: `- [ ]` → `- [x]`. Touch ONLY that one
  task; do not reorder, edit, or delete other Plan items unless the
  user asked.
- **Add a reflection sub-bullet** under the same task. One sentence,
  declarative. Example: `  - Result: loss = 2.41 at step 10k; below
  baseline (2.55) — H0003 holds at bs=8.`.
- **`## Conclusion`** — update ONLY if the cross-run pattern is now
  defensible (≥ 2 runs in the experiment agreeing in the same
  direction). Otherwise leave it. Per-run results live in Plan
  reflections until the pattern is clear.
- **`## Caveats`** — update if a new interpretation limit emerged
  (e.g. "the bf16 result only holds at batch ≥ 8").
- **`## Method`** — update ONLY if the methodology itself changed
  (e.g. a new dataset slice, a new eval metric introduced).

All writes go through `memon experiment readme write "$EXP_ID"
--project-root . --expected-mtime "$MTIME"`. Capture the new mtime
from the response for the next write. On exit 9 (`CONFLICT`),
refresh mtime via `memon experiment show ... --format json | jq -r
.mtime`, re-apply, retry once; on a second conflict, stop and
surface to the user.

### 3b. After a reviewable code change lands: offer a code-review

When a Plan item produced a **non-trivial code change** — a new feature, a
bug fix, or a refactor that landed as one or more commits (i.e. there is now
code a human would want to review) — and it has not already been written up,
proactively ask the user whether to capture it as a code-review doc. On a
yes, hand off to `memon-write-code-review` scoped to this experiment (the doc
lands in `docs/experiments/<EXP_ID>/code-review/`). Ask **once per reviewable
unit, not per commit**, and skip it for runs / sweeps that produced results
but no code change (those belong in Plan reflections / `## Conclusion`):

> 这次「<one-line summary of the change>」落了代码(`<n>` 个 commit),
> 要不要我生成一份 code-review 方便你过一遍?(会挂在本实验下)

On a yes, invoke `memon-write-code-review`. On a no, drop it and continue.

### 4. Continuously transcribe conversation into the exp doc

The user is the source of truth for what the experiment is about
and where it's headed. As the conversation evolves, content lands
in the right section as soon as it surfaces — don't wait until a
Plan task completes:

- **A design decision the user makes** — if methodology, update
  `## Method`. If next-step, update `## Plan`.
- **A caveat the user names** — `## Caveats`. (Don't wait for the
  end of the experiment.)
- **A motivation refinement the user gives** — `## Motivation`.
- **A failed direction the user explicitly abandons** — strike
  through the corresponding Plan item (`- [~] ~~old task~~`) or
  remove it (with a reflection sub-bullet on a successor task
  noting "abandoned because <reason>").

If unsure whether a piece of conversation content is worth recording
or where it belongs, ask the user briefly (in Chinese):

> 这条要不要记到 exp doc?我倾向放到 `<section-name>`(<one-line
> rationale>)。可以吗?

Default to recording rather than dropping. Over-recording is
recoverable (the user can edit); under-recording leaves the doc
behind the discussion and defeats the orchestrator's purpose.

### 5. Consider FINISHED when criteria align

After any disk update, check three signals:

1. Every `- [ ]` in `## Plan` is now `- [x]`.
2. Every member run in the exp's `runs[]` is terminal (`FINISHED` or
   `FAILED`, not `RUNNING` or `PENDING`).
3. `## Conclusion` is non-empty.

When all three hold, surface to the user (in Chinese):

> 这个 experiment 看起来可以收尾了(Plan 全勾 / 所有 run 都终止 /
> Conclusion 有内容)。要不要标成 FINISHED?

The user's `yes` is the actual trigger. This skill SHALL NOT call
any status-set CLI without that confirmation.

## Per-experiment scratch space (the v5 exp folder)

The exp folder at `<projectRoot>/docs/experiments/E<NNNN>-<slug>/` is the
v5-sanctioned scratch space for artifacts that live with one specific
experiment. The README lives there; everything else next to it is the
user's local-to-this-exp space.

**Core placement criterion** — for any new script / artifact, ask:

> Is this script reusable outside this one experiment — i.e. would
> someone working on a different experiment, or another contributor,
> directly pick it up and use it as-is?

- **No** (only useful to this experiment / this user / this cluster) →
  exp folder, `docs/experiments/E<NNNN>-<slug>/`.
- **Yes** (genuinely portable / cross-experiment) → main repo,
  `<projectRoot>/scripts/<area>/` or the project's `recipe/` /
  shared-code area.

The criterion is reusability, NOT importance: an analysis script that
produces a key conclusion for this experiment still lives in the exp
folder if it's specific to this experiment's data / setup. Anyone
reproducing this experiment's results finds the script alongside the
experiment doc — that's the point of the scratch space.

**Examples**:

- **sbatch / cluster-launcher scripts** → exp folder. Only useful on
  this user's slurm cluster; not portable; nobody else can reuse them
  as-is. Even though they're "launchers", they don't belong in
  `<projectRoot>/scripts/<area>/`.
- **Ad-hoc analysis scripts that just answer a user question** → exp
  folder. Throwaway / context-specific; other contributors don't care.
- **Analysis scripts that produce experiment-specific conclusions** →
  exp folder. Still tied to this experiment's runs/data; reproducing
  the conclusion means re-running THIS script on THIS data. Keeping it
  alongside the README is how a future reader connects the script to
  the result it produced.
- **Result files** (figures, summary CSVs, learned parameter snapshots)
  → exp folder, alongside the script that produced them.
- **General CSV-to-figure pipeline that anyone can reuse** → main repo
  (`scripts/<area>/analysis/`). Reusable across experiments.

**Size policy (git vs. gitignore)**:

- File **< 1 MB**: commit via git alongside the exp README. Future
  readers see the artifact when they read the experiment.
- File **≥ 1 MB**: do NOT commit. Add a corresponding pattern to
  `.gitignore` (project-level OR a new
  `docs/experiments/E<NNNN>-<slug>/.gitignore` scoped to the folder).
  The agent SHALL ask the user before committing any large binary —
  the default is gitignore.

**What does NOT belong in the scratch space**:

- Reusable cross-experiment helpers → main repo.
- Run-dir contents (logs, checkpoints, the run's own README) → those
  stay in the run dir under `<projectRoot>/<...>/<slug>-<YYMMDD>-<HHMMSS>/`.
- Content that should be on a sibling exp doc (e.g. a finding that
  applies to a different exp's runs) — write it there directly.

Reference any scratch-space artifact from the Plan reflection sub-bullets
with its relative path:

> - ran `docs/experiments/E0007-bf16-numerics/plot_loss.py` on run X →
>   figure saved at `docs/experiments/E0007-bf16-numerics/loss_curve.png`

## Distinguishing launcher scripts from analysis utilities

The decision is mechanical given the criteria below. Quick test,
applied to any code you're about to write:

| Aspect | Launcher (use `memon-write-script`) | Analysis util (write inline) |
|---|---|---|
| Output | A run dir matching `^.+-\d{6}-\d{6}$` | A figure / CSV / stdout print / small JSON |
| Lifecycle | RUNNING → terminal, with README owner | One-shot, no state |
| GPU | Usually yes | Usually no |
| Wall time | Minutes to days | Seconds to minutes |
| `[memon] ...` echo lines | Yes (Convention #5 from `memon-write-script`) | No |
| README ownership | Yes (`memon-run-experiment` writes it) | No |
| Exp doc `## Method` registration | Yes (one bullet per script) | No |
| Reproducibility test | Reruns lose info without checkpoints | Reruns produce same output given same input |

If unsure, default to **inline analysis**. The exp doc only gains
noise from over-registering one-shot helpers in `## Method`. If
later it turns out the helper grew into something heavier (now needs
GPU, now produces a run dir), it can be promoted to a real launcher
via `memon-write-script` at that point.

## Section-routing reference

Where conversation content lands in the exp doc:

| User says / agent observes | Section |
|---|---|
| "Let's investigate X because Y" | `## Motivation` |
| "The methodology is: <stable description>" | `## Method` |
| Script registration (`- \`scripts/foo/run.sh\` — purpose`) | `## Method` |
| "Next, try Z" / "We should sweep W" | `## Plan` as `- [ ] task` |
| Per-run observation, not yet defensible cross-run | `## Plan` task → reflection sub-bullet |
| Defensible cross-run finding (≥ 2 runs agree) | `## Conclusion` |
| Interpretation caveat ("only at batch ≥ 8") | `## Caveats` |
| Anomaly the human MUST adjudicate | `## Warnings` (via `memon run warning add`) |
| Cross-cutting observation not tied to this exp | `docs/journal.md` `[NOTE]` event |

When the routing isn't obvious, ask the user (in Chinese):

> 这条 (`<content snippet>`) 我倾向放到 `<section-name>`(<rationale>)。可以吗?

## Anti-patterns

- ❌ Writing a python analysis helper via `memon-write-script`. Place
  it in the exp folder (`docs/experiments/E<NNNN>-<slug>/`) — the v5
  sanctioned home for experiment-local tooling — or, if it's a generic
  cross-experiment util, under `scripts/<area>/analysis/`. Do NOT
  register it in `## Method`.
- ❌ Kicking off a run before the next Plan task is settled.
  Iterate design until the three pre-action gates (concrete action,
  defined I/O, success criterion) are all settled.
- ❌ Filling `## Conclusion` with per-run learnings because the
  section is empty. Use Plan reflections until a defensible
  cross-run pattern exists.
- ❌ Treating Plan as immutable. Plan is a working area — items get
  added, edited, removed, reordered as the experiment evolves with
  the user.
- ❌ Skipping the Plan update after a run finishes. Every terminal
  run SHOULD produce either a `[x]` + reflection on an existing
  Plan item, or a new Plan item (if the run revealed something
  worth probing next).
- ❌ Auto-transitioning the exp to `FINISHED` without the user's
  `yes`. The three-signal check is a *signal*, not auto-promote.
- ❌ Conclusion drifting into "we tried X and Y and Z" itemised log
  format. Conclusion is the cross-run finding; per-run trial
  itemisations belong as Plan reflections.
- ❌ Ignoring an existing exp's `runs[]` + Plan when resuming in
  Mode B. Always read both before suggesting next steps.
- ❌ Dropping conversation content on the floor when unsure where it
  belongs. Ask the user; over-recording is recoverable, lost
  context isn't.
