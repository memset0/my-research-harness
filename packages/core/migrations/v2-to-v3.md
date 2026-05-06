# v2 → v3 migration

## Background / Why

memon `FS_CONVENTION_VERSION` bumped from `2` to `3` to introduce the
**experiment doc** layer at `<projectRoot>/docs/experiments/E<NNNN>-<slug>.md`,
a logical grouping for the run dirs that previously had to repeat motivation
/ method / conclusion text in every README. The motivating change is
`new-experiment-system` (see `openspec/changes/new-experiment-system/`).

In v3:

- An **experiment** is the file `docs/experiments/E<NNNN>-<slug>.md` that
  owns motivation / method / conclusion / caveats / warnings across one or
  more runs.
- A **run** is the existing `logs/<slug>-<YYMMDD>-<HHMMSS>/` directory,
  trimmed to setup / result / artifacts only on the body side and gaining
  `experiment:` and `updated_at:` on the frontmatter side.
- The legacy v2 frontmatter fields `project:` (sub-project label),
  `hypotheses:`, and `tags:` are removed from runs; the latter two move to
  the experiment doc.
- The legacy `## New Hypotheses` body section is removed entirely;
  hypothesis discussion moves into the exp doc's Motivation / Conclusion.
- The Warnings table gains a `Run` column so an exp-level warning can name
  the run it originated from.

Unlike v1→v2 (which was a deterministic file move), v2→v3 requires
**judgement**: which runs share an investigation and should belong to the
same experiment? The agent walks through the survey → cluster → confirm
loop with the user before any disk write happens.

### Procedure (agent-facing step list)

`memon-migrate-fs` invokes this guide with the per-step protocol from
its §5. For v2→v3 specifically, the work inside the step is non-trivial;
the agent SHALL execute these in order, pausing for the user-confirm
gate in step 3 before any filesystem write:

1. **Survey** — list every v2 run README under each `<projectRoot>/<…>/<slug>-<YYMMDD>-<HHMMSS>/README.md`. For each, parse and extract:
   - frontmatter `project` / `hypotheses` / `tags` / `name` / `created_at`
   - body sections: `Motivation`, `Method`, `Conclusion`, `Caveats`, `Warnings` (with row content), `New Hypotheses`
   - keep this in memory; do NOT write anything yet.

2. **Cluster** — group runs by qualitative similarity of motivation +
   method. Most natural clusters fall out of the existing
   `frontMatter.hypotheses` overlap + reading the motivation prose for
   each run. Allocate `E<NNNN>` IDs monotonically starting from `E0001`.
   For each cluster, propose a `<slug>` and `<title>`. Single-run
   experiments are valid (per the Edge Cases section).

3. **Confirm with the user** — present the proposed grouping in
   plain text in the chat (NO disk write yet). Format:

   > 我建议拆成 N 个 experiment：
   > - E0001-`<slug>` (`<title>`) 包含: foo-260501-100000, bar-260502-150000
   > - E0002-`<slug>` (`<title>`) 包含: baz-260503-080000
   > - …
   > 是否确认？(y / 提建议修改)

   Loop until the user says yes. **No filesystem writes happen before
   user approval.**

4. **Generate experiment docs** — for each approved cluster, write
   `docs/experiments/E<NNNN>-<slug>.md` per the Diff section's
   "File 3" template. Merge motivation/method/conclusion/caveats from
   the cluster's member runs (deduplicate). The Warnings table — if
   any member run had warnings — preserves rowIds and gains a `Run`
   column populated with the source run dir.

5. **Rewrite run READMEs** — for each migrated run, apply the Diff
   section's "File 1" + "File 2" template:
   - frontmatter: drop `project` / `hypotheses` / `tags`; add
     `experiment: E<NNNN>-<slug>` and `updated_at: <migration-time-ISO>`
   - body: keep only `## Setup` / `## Result` / `## Artifacts`; strip
     Motivation / Method / Conclusion / Caveats / Warnings / New
     Hypotheses

6. **Verify bidirectional binding** — for every E doc, every entry in
   `runs[]` must exist on disk and have matching `experiment:`
   back-reference; for every run with `experiment:` set, the named exp's
   `runs[]` must contain the run's dir base name. Run the verification
   commands from `## Verification` below; abort on any mismatch.

7. **Optional batch run rename** — ask the user (in Chinese):

   > 是否把每个 run 的 slug 改成对应 experiment slug 的前缀，方便日后
   > 一眼看出归属？例如 foo-260501-100000 → vpred-convergence-foo-260501-100000。
   > 不改也没问题，只是软约定的视觉提示。(y/N)

   On `y`, run `memon run rename` for each. On any other answer, skip
   this step (the soft-prefix violation is non-blocking).

8. **Update `docs/hypotheses.md`** — see the Diff section's "File 4".
   Each per-H entry's `Experiments:` field now lists `E<NNNN>-<slug>`
   IDs; the new `Runs:` field captures specific runs. Also update the
   Summary table at the top of the file.

9. **Bump the marker** — see the Diff section's "File 5". Per the
   migrate-fs runtime protocol, this happens together with the commit
   in `memon-migrate-fs`'s §5 (after verification).

## Detection

Run each of the following from `<projectRoot>`. ALL of these conditions
SHALL be true for a v2 project root that needs migrating:

- `jq -r '.fs_convention_version' "$PROJECT_ROOT/.memon/version.json" | grep -qx 2 && echo OK` — version marker says `2`.
- `test ! -d "$PROJECT_ROOT/docs/experiments" && echo OK` — no experiment-doc dir yet (or it's empty: `[ -z "$(ls -A docs/experiments 2>/dev/null)" ] && echo OK`).
- `find "$PROJECT_ROOT" -path "*/logs/*-[0-9][0-9][0-9][0-9][0-9][0-9]-[0-9][0-9][0-9][0-9][0-9][0-9]/README.md" -print -quit | grep -q . && echo OK` — at least one run README exists in v2 layout.
- `find "$PROJECT_ROOT" -path "*/logs/*-[0-9][0-9][0-9][0-9][0-9][0-9]-[0-9][0-9][0-9][0-9][0-9][0-9]/README.md" -exec grep -lE '^(project|hypotheses|tags):' {} \; | head -1 | grep -q . && echo OK` — at least one run README still has the legacy frontmatter fields.

If only some run READMEs have the legacy fields (e.g. some have already
been hand-migrated), proceed step-by-step: skip the no-op rewrites and
still create the missing experiment docs. See `## Edge Cases`.

## Diff (v2 → v3)

### File 1: each run README's frontmatter

before:

```yaml
---
id: foo-260501-100000
name: foo
project: project-a
status: RUNNING
created_at: 2026-05-01T10:00:00+08:00
finished_at: null
host: gpu-node-07
pid: 12345
gpus: [0, 1, 2, 3]
entry: ./train.sh
command: bash train.sh ...
wandb: https://wandb.ai/...
hypotheses: [H0001, H0003]
tags: [diffusion, v-pred, zero-snr]
---
```

after:

```yaml
---
id: foo-260501-100000
name: foo
status: RUNNING
created_at: 2026-05-01T10:00:00+08:00
updated_at: 2026-05-04T14:00:00+08:00   # set to migration time
experiment: E0001-vpred-convergence     # the parent experiment id
finished_at: null
host: gpu-node-07
pid: 12345
gpus: [0, 1, 2, 3]
entry: ./train.sh
command: bash train.sh ...
wandb: https://wandb.ai/...
---
```

The fields `project`, `hypotheses`, `tags` are removed from the run. Their
content moves to the parent experiment doc (see File 3).

### File 2: each run README's body

before:

```markdown
## Motivation
…replicate the v-pred convergence advantage…

## Setup
- 4× A100 …

## Method
1. Train two parallel runs…

## Result
(In progress…)

## Conclusion
(Pending…)

## Caveats
- only one resolution (256²) …

## Artifacts
- `./checkpoints/` — DiT + EMA checkpoints
…
```

after:

```markdown
## Setup
- 4× A100 …

## Result
(In progress…)

## Artifacts
- `./checkpoints/` — DiT + EMA checkpoints
…
```

The sections `Motivation`, `Method`, `Conclusion`, `Caveats`, `Warnings`,
`New Hypotheses` are stripped from the run. The first three move to the
experiment doc; `Warnings` rows move to the experiment doc's table with
the new `Run` column populated; `New Hypotheses` content (if any) is
inlined into the experiment doc's Motivation / Conclusion as appropriate
or moved into `docs/hypotheses.md` if it documents new hypothesis IDs.

### File 3: new experiment doc — `docs/experiments/E<NNNN>-<slug>.md`

added (only the `after` block since this file is new):

```markdown
---
id: E0001-vpred-convergence
slug: vpred-convergence
title: "v-prediction vs ε-prediction convergence study"
runs: [foo-260501-100000, bar-260502-150000]
hypotheses: [H0001]
tags: [diffusion, v-pred, convergence]
created_at: 2026-05-01T10:00:00+08:00   # earliest member run's created_at
updated_at: 2026-05-04T14:00:00+08:00   # migration time
---

## Motivation

<merged motivation prose from each member run, deduplicated>

## Method

<merged method prose from each member run>

## Conclusion

<merged conclusion across all member runs; reference H<NNNN> with verdict>

## Caveats

<deduplicated caveats from member runs>

## Warnings

| Status | Created | Run | Category | Message | Resolved | Note |
| --- | --- | --- | --- | --- | --- | --- |
<one row per migrated warning; the `Run` column carries the source run dir>
```

### File 4: `docs/hypotheses.md`

before (per-H entry):

```markdown
## H0001. v-prediction-converges-faster
- **Statement**: …
- **Origin**: …
- **Status**: ✅ CONFIRMED
- **Experiments**: foo-260501-100000, bar-260502-150000
- **Evidence**: …
- **Caveats**: …
- **Last verified**: 2026-05-02
```

after:

```markdown
## H0001. v-prediction-converges-faster
- **Statement**: …
- **Origin**: …
- **Status**: ✅ CONFIRMED
- **Experiments**: E0001-vpred-convergence
- **Runs**: foo-260501-100000, bar-260502-150000
- **Evidence**: …
- **Caveats**: …
- **Last verified**: 2026-05-02
```

The `Experiments:` field is reinterpreted to list experiment IDs
(`E<NNNN>-<slug>`); the new `Runs:` field captures any specific runs the
hypothesis is anchored on. The Summary table at the top of the file
similarly switches to E IDs.

### File 5: `<projectRoot>/.memon/version.json`

before:

```json
{
  "fs_convention_version": 2,
  "installed_at": "...",
  "last_migrated_at": "..." | null
}
```

after:

```json
{
  "fs_convention_version": 3,
  "installed_at": "...",
  "last_migrated_at": "<migration-time-ISO>"
}
```

## Target State (v3 Summary)

After a successful v2 → v3 migration, the project root SHALL look like:

```
<projectRoot>/
  docs/
    journal.md            # unchanged
    hypotheses.md         # Experiments:/Runs: split applied
    experiments/          # NEW directory
      E0001-<slug>.md
      E0002-<slug>.md
      …
    reports/              # unchanged
    digests/              # unchanged
  logs/
    <slug>-<YYMMDD>-<HHMMSS>/
      README.md           # frontmatter trimmed; body sections trimmed
      …                   # actual outputs unchanged
  .memon/version.json     # fs_convention_version: 3, last_migrated_at set
  config.yml              # unchanged
```

Specifically:

- For every `logs/<...>/README.md` that previously listed `project:`,
  `hypotheses:`, or `tags:` in frontmatter, those fields are gone, and the
  README has `experiment: E<NNNN>-<slug>` (or no `experiment:` field at
  all if the run is genuinely orphan) and `updated_at: <ISO>`.
- For every distinct investigation across runs, there is exactly one file
  at `docs/experiments/E<NNNN>-<slug>.md` and its `runs[]` lists the
  member run dir base names.
- For every member run, `<run>.frontMatter.experiment === E_id` AND
  `E.frontMatter.runs[]` contains the run's dir base name (bidirectional
  binding).
- `docs/hypotheses.md` per-H entries reference experiment IDs in
  `Experiments:` and (optionally) run dir names in `Runs:`; the Summary
  table at the top references E IDs.
- `.memon/version.json` reports `fs_convention_version: 3` with
  `last_migrated_at` set to the ISO8601 timestamp of this step.

## Verification

```bash
# Each successful check prints OK; any non-zero exit aborts the migration step.

# v2 frontmatter fields are gone from every run README
! find "$PROJECT_ROOT" -path "*/logs/*-[0-9][0-9][0-9][0-9][0-9][0-9]-[0-9][0-9][0-9][0-9][0-9][0-9]/README.md" \
    -exec grep -lE '^(project|hypotheses|tags):' {} \; | grep -q . \
  && echo OK

# Every run README either has experiment: E<NNNN>-<slug> or has no experiment field
find "$PROJECT_ROOT" -path "*/logs/*-[0-9][0-9][0-9][0-9][0-9][0-9]-[0-9][0-9][0-9][0-9][0-9][0-9]/README.md" \
  -exec grep -E '^experiment:' {} \; \
  | grep -vE '^experiment:\s*(E[0-9]{4}-[a-z0-9-]+|null|)\s*$' \
  | grep -q . \
  && echo NOT_OK || echo OK

# At least one experiment doc was created
test -d "$PROJECT_ROOT/docs/experiments" \
  && find "$PROJECT_ROOT/docs/experiments" -maxdepth 1 -name 'E[0-9][0-9][0-9][0-9]-*.md' -print -quit | grep -q . \
  && echo OK

# Every experiment doc filename matches E<NNNN>-<slug>.md
! find "$PROJECT_ROOT/docs/experiments" -maxdepth 1 -name '*.md' -type f \
    -not -name 'E[0-9][0-9][0-9][0-9]-*.md' | grep -q . \
  && echo OK

# Hypotheses file has Experiments:/Runs: split applied (at least one Runs: line)
test ! -f "$PROJECT_ROOT/docs/hypotheses.md" \
  || grep -qE '^- \*\*Runs\*\*:' "$PROJECT_ROOT/docs/hypotheses.md" \
  || ! grep -qE '^- \*\*Experiments\*\*:.*-[0-9]{6}-[0-9]{6}' "$PROJECT_ROOT/docs/hypotheses.md" \
  && echo OK

# Version marker advanced to 3
jq -r '.fs_convention_version' "$PROJECT_ROOT/.memon/version.json" | grep -qx 3 && echo OK

# last_migrated_at is non-null
jq -e '.last_migrated_at != null' "$PROJECT_ROOT/.memon/version.json" > /dev/null && echo OK
```

## Rollback Notes

If the migration aborts mid-step, the user has two recovery paths
depending on whether the project root is a git repository:

- **Git mode**: `git revert HEAD` undoes the just-committed migration step.
  The runtime's per-step protocol commits with the literal message
  `chore(memon): migrate FS convention v2 -> v3` (ASCII arrow, no body, no
  trailing period), so reverting that single commit restores the v2
  layout exactly.
- **Non-git mode**: the runtime takes a tarball snapshot under
  `<projectRoot>/.memon/backup/` before the step. Extract the tarball
  back into `<projectRoot>` to restore the v2 state.

Tell the user: "v2 → v3 migration aborted. To roll back, run
`git revert HEAD` (in git mode) or extract
`<projectRoot>/.memon/backup/<latest>.tar.gz` (non-git mode), then
investigate the failure before retrying."

## Edge Cases

- **Single-run experiment** — only one run exists for an investigation
  (e.g., a one-off probe). Handling: still create an experiment doc with
  one entry in `runs[]`. Even one-run experiments benefit from the
  motivation/method/conclusion separation; agents should not collapse
  these into orphan runs.

- **Run motivation forks two investigations** — one run mentions both
  H0001 and a separate H0007 with no clear primary lens. Handling: ask
  the user which experiment the run primarily belongs to; assign it
  there. The hypothesis cross-ref (`Runs:` field on H0007's entry in
  `docs/hypotheses.md`) preserves the secondary connection without
  forcing the run into two experiments — runs belong to at most one
  experiment per `experiment-readme` D8.

- **Pre-existing `docs/experiments/` directory with user files** — abort
  with a named error and ask the user to relocate. The migration MUST
  NOT overwrite or merge with user content in that path.

- **Run with no Motivation/Method/Conclusion content at all** (e.g., a
  half-finished v2 README that never got prose past Setup/Result):
  surface to the user. Either (a) place it under the closest matching
  experiment with a comment, or (b) treat it as an orphan run (no
  `experiment:` binding). The agent SHALL NOT silently fabricate
  motivation text — fabricated text on real research is a correctness
  hazard.

- **User-added custom frontmatter fields on runs** (fields not in
  memon's documented schema). Handling: PRESERVE the entire frontmatter
  block byte-for-byte during the rewrite, removing only the three
  explicitly-deleted fields (`project`, `hypotheses`, `tags`) and adding
  the two new fields (`experiment`, `updated_at`). Custom keys SHALL
  appear unchanged.

- **User mid-edit (working tree dirty)** — handled at the runtime layer
  per `openspec/specs/fs-migration-runtime/spec.md` (refuses to begin
  migration with a dirty tree). This guide assumes a clean tree.

- **Concurrent migration** — two `memon-migrate-fs` invocations against
  the same project root at once. Handling: the tool does NOT lock.
  Concurrent invocations are the user's problem; if a second invocation
  observes a half-migrated state (e.g. some run READMEs already trimmed
  while others still have legacy fields), it MAY refuse with an error
  and instruct the user to roll back to a known-good state and retry
  serially.

- **No hypotheses file** — `docs/hypotheses.md` does not exist. Handling:
  skip File 4's diff. The migration still bumps `.memon/version.json` to
  v3.

- **Skill content is still v2-shaped** — `.memon/skills/memon-write-script/`
  etc. still teaches the v2 single-file model. Handling: this guide does
  NOT update skill content. A follow-up change updates the skills; until
  then, the agent's existing v2 skill prompts are sufficient to walk the
  v2 → v3 migration described here. After the skill update lands, agents
  will produce v3-shaped READMEs by default.
