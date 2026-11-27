# Proposal

**Status: proposed (2026-11-26), awaiting owner review.** Depends on the active `add-discussions` change; archive that change first so these requirements land on its `discussions` spec.

## Why

Discussions currently only manage the agent's questions. The owner wants each discussion to work as the shared workspace for one goal, such as a refactor or new feature, so both sides can see what has been settled, what the agent has actually built, and which Reports back each decision.

Today, a DECIDED question reads as "finished" even when nothing has been implemented. Work items that need no answer have no place, and Reports are linked only by ad-hoc prose.

## What Changes

- **Goal**: a discussion MAY state its shared goal with an optional one-line `goal` field in frontmatter. The discussion itself is the goal; there is no separate goal entity, and categories keep grouping the sub-topics.
- **Work axis**: every question MAY carry `work: TODO | DOING | DONE | SKIP`, separate from its decision `status`.
  - Agents set it.
  - DONE or DOING before DECIDED is a diagnostic.
  - SKIP means "settled; nothing to implement" and counts as complete.
- **Decider**: `decided_by: owner | agent` records who settled a DECIDED question. Agent-settled questions count as settled immediately and are labelled "agent decided". The owner can overturn one by responding, using the existing feedback flow. `resolve` fills `decided_by` automatically: `owner` when it acknowledges owner responses, otherwise `agent`.
- **Subgoal unit**: a new question type, `subgoal`.
  - It has no answer field. It is a "fill-in question without the blank": the owner can still comment, annotate and give feedback, and the agent acknowledges and replies as usual.
  - It counts as settled from the start and advances progress when its `work` becomes DONE.
  - It may not be DECIDED or carry options, preferences or decisions.
- **Report references**:
  - Questions MAY list `refs: [R0012, R0014#benchmarks]`. They render as linked badges using the Report title from the published catalog; unresolved refs render as warnings.
  - Relative Markdown links to Report bundles in question descriptions and agent replies also count as references.
  - Refresh publishes references in `discussions.json`. Each Report page lists the published discussions and questions that reference it, and the same Report may be cited any number of times.
- **Progress**:
  - The discussion header shows a segmented progress bar: completed · settled awaiting work · waiting for the owner · awaiting the agent's response · other unsettled.
  - DROPPED is excluded from the count. DEFERRED is shown beside the bar but not counted.
  - Discussion list rows show a compact settled/completed summary.
- **CLI**:
  - `memon discussion work D0001/ID <TODO|DOING|DONE|SKIP>`, a guarded single-field rewrite.
  - `memon discussion todo` lists settled, unfinished work across OPEN discussions.
  - `show` gains progress counts.
  - `resolve` accepts `--work` and `--by`.
- **Skill guidance**: bundled `memon-research` guidance teaches agents to state the goal, add subgoals, mark work as it lands, and cite Reports with `refs`.
- **Compatibility**: the change stays on FS convention 12. The release is a MINOR bump because the CLI and skills change. Event log lines are unchanged. Old CLIs keep reading `work`, `decided_by`, `refs` and `goal`, because the question schema passes through unknown keys. Old CLIs report `type: subgoal` questions as invalid-type diagnostics until the node runs `memon update`. The owner accepted this.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `discussions` (introduced by the active `add-discussions` change): adds the goal field, the work axis, the decider, the subgoal type, Report references with backlinks, progress, and new CLI commands. These requirements are added on top of that change's spec.

## Impact

- **`packages/core` discussion code**:
  - Question schema and diagnostics.
  - Derived progress.
  - Reference extraction.
  - The catalog schema.
  - The guarded single-field fence edit, reused for `work`.
- **`packages/cli` discussion commands**: the new `work` and `todo` commands, plus the `resolve` and `show` changes above.
- **Bundled `memon-research` skill**: the agent guidance above.
- **Backend and Web**: discussion services and DTOs, the Report-page "Referenced by" read, the discussion header progress, list summaries, subgoal cards (comment-only form), ref badges, and query keys.
- **Not affected**: the event log, the File Agent, and authorization. No new database, watcher or FS marker change.
