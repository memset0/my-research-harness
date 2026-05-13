## Context

The status model has two pain points:

1. **Run status enum has no slot for "human stopped this."** `PENDING` / `RUNNING` / `FINISHED` / `FAILED` / `UNKNOWN` collapses Ctrl-C / "kill that, I changed my mind" / SLURM-time-limit-but-I-asked-for-it onto `FAILED`. The dashboard's red badge over-claims a code-level failure, and downstream triage loses the human-intent signal. `FAILED` should mean the program itself errored (anything inferrable from `run.log`), not "I pressed stop."
2. **Experiment has no manual status.** The card pill is computed by aggregating member-run statuses (`apps/web/components/experiment-card-grid.tsx:65`). This conflates two different things: "is anything still running here?" (a derived runtime fact) and "have I declared this investigation done?" (a human-asserted lifecycle decision). With no field for the latter, the user cannot say "this experiment reached its motivation" or "we set this aside without a clean answer" — the dashboard keeps showing a green ✅ once all runs finish, regardless of whether the user actually concluded anything from them.

This change fixes both. Run status gets `INTERRUPTED` (human-only). Experiment frontmatter gets a `status` field with `OPEN` / `RESOLVED` / `ABANDONED`, defaulting to `OPEN`. Both new states are **never** auto-derived; the orchestrator and the discovery codepath are forbidden from writing them. The UI palette is refreshed so the six run statuses and three experiment statuses are visually distinct. `FS_CONVENTION_VERSION` bumps from 3 to 4, and the v3→v4 migration walks all existing experiment docs to fill `status: OPEN`.

## Goals / Non-Goals

**Goals:**
- Add `INTERRUPTED` to the run status enum with crisp **human-only** write semantics.
- Add a new `ExperimentStatus` enum (`OPEN` / `RESOLVED` / `ABANDONED`) and a corresponding `status` field to `ExperimentFrontMatter`. Default `OPEN`. Same human-only write rule.
- Replace the experiment-card pill's source from "aggregate of member-run statuses" to "the experiment doc's manual `status` field." Move member-run runtime counts to a secondary line under the card title.
- Refresh per-status UI colors so all six run states and all three experiment states are visually distinct, with `UNKNOWN` rendering in a deeper / muted-red tone separable from `FAILED`.
- Bump `FS_CONVENTION_VERSION` from 3 to 4 with a v3→v4 migration that fills `status: OPEN` on every existing experiment doc lacking the field. Run READMEs are not touched by the transform — the run-status enum widening is purely additive.
- Author `packages/core/migrations/v3-to-v4.md` per `fs-migration-guide-authoring/spec.md` covering both the run-side enum extension and the exp-side OPEN-fill.

**Non-Goals:**
- Changing the `HypothesisStatus` enum or its emojis / colors.
- Touching the stale-RUNNING heuristic. `INTERRUPTED` is **not** a "stale RUNNING gets auto-promoted to" state; stale-RUNNING continues to render as a `lucide AlertTriangle` overlay on a still-`RUNNING` badge.
- Auto-deriving `INTERRUPTED` from log analysis or signal handling. The whole point of the new state is to carry intent that automated code cannot reliably distinguish.
- Auto-deriving `ExperimentStatus` from member runs. The whole point of the new field is to let the user assert lifecycle decisions independently of run-state aggregation.
- Adding a fourth experiment status (e.g. `ABANDONED_TEMPORARILY` / `ON_HOLD`). The user explicitly chose three. If `ABANDONED` proves too coarse later, that ships as its own change.
- Rewriting agent skills (memon-drive, run-experiment, etc.) that mention status values. Per the established split-runtime-then-skills convention, that ships in a follow-up after this change is verified in production.
- Renaming any field, file, or directory on disk. The only schema change is one new optional-but-backfilled field on the experiment doc; the run README frontmatter shape is unchanged.

## Decisions

### D1. `INTERRUPTED` is human-only; never inferred from logs

**Decision:** The orchestrating agent and the run-discovery / scan code SHALL NOT auto-promote any run to `INTERRUPTED`. The only legitimate writers are: (a) the user editing a run README directly, (b) `memon run status set --to INTERRUPTED <run>`, (c) the web UI's status picker, (d) an agent acting on an explicit user instruction to stop ("interrupt run X").

**Why:** The user explicitly stated this in the proposal conversation: "如果你自己从 run.log 分析状态的话一定不会是中断状态。中断状态只会是用户手动要求 agent 中断实验的时候，或者是用户手动把某一个 run 设置为中断状态的时候才有用." The whole point of the new state is to carry the human intent that a non-zero exit cannot. If we let the orchestrator guess (e.g. "process got SIGTERM → INTERRUPTED"), we re-introduce the ambiguity we are trying to remove: was the SIGTERM from the user, from SLURM, or from a sibling job's OOM killer? `FAILED` correctly covers all three; `INTERRUPTED` is reserved for the human-asserted case.

**Alternative considered:** A heuristic — "if the last journal `[STATUS]` event before exit was a `[NOTE]` containing 'interrupt' or 'stop', mark as INTERRUPTED." Rejected: brittle, would silently mis-classify, and offers nothing the user can't do explicitly with `memon run status set`.

**Concrete consequence:** The `memon scan` / `discoverRuns` codepath SHALL NOT introduce any code branch that writes `INTERRUPTED`. Only `setStatus` (the explicit-write path) accepts the value.

### D2. Experiment gains a manual `status` frontmatter field; aggregation drops to a secondary signal

**Decision:** `ExperimentFrontMatter` gains a required `status: ExperimentStatus` field. The enum is `OPEN` / `RESOLVED` / `ABANDONED` (`type ExperimentStatus = 'OPEN' | 'RESOLVED' | 'ABANDONED'`). The card pill on the experiment-card grid renders **this** field; the previous member-run aggregation is replaced.

Member-run runtime state remains derivable but is demoted: the experiment-card title row gets a small secondary line beneath it summarising the run roster (e.g. `2 running · 5 done · 1 interrupted`) so a glance still surfaces "is anything in flight here?" without conflating it with the investigation lifecycle.

**Why:** The user's instruction was explicit: "experiment 也需要手动记录一下状态" + "感觉有这样三个状态应该就够了" + "手动状态为主，运行状态退为详情." The two signals (investigation lifecycle vs. run-roster runtime) are different and a single pill cannot represent both honestly. Demoting aggregation to a secondary line preserves the at-a-glance "anything running here?" affordance without overloading the primary status.

**Naming chosen:** The user picked `OPEN / RESOLVED / ABANDONED` from a four-option vote (alternatives: `IN_PROGRESS / SUCCEEDED / FAILED`, `IN_PROGRESS / CONCLUDED_SUCCESS / CONCLUDED_FAILURE`, `IN_PROGRESS / ACHIEVED / INCONCLUSIVE`). Rationale for the chosen names:
- `OPEN` reads as "investigation is in progress, work continues." Crucially, **no overlap** with run-side enum tokens (compare `IN_PROGRESS` vs the existing `RUNNING` ambiguity). Borrows from issue-tracker vocabulary that the user is already comfortable with.
- `RESOLVED` reads as "investigation closed, motivation reached." Also borrowed from issue-tracker convention. Distinct from run-side `FINISHED` (which describes a single run's process exit).
- `ABANDONED` reads as "investigation closed, motivation **not** reached / dropped." Notably **not** `FAILED` — there's no implication anything erred; the user just decided not to pursue further.

**No fourth value (e.g. `ABANDONED_TEMPORARILY`).** The user was asked and answered "不需要，三个足够." If an experiment is paused-but-not-yet-given-up-on, it stays `OPEN`.

**Alternative considered:** Optional override field that defaults to aggregation when unset. Rejected: introduces a "did the user set this or is it derived?" ambiguity that the simpler "always manual, default `OPEN`" rule avoids. Aggregation is still computed for the secondary line, so nothing is lost.

### D3. Run-status aggregate precedence (now used only for the secondary line, not the pill)

**Decision:** The aggregate-of-member-runs computation continues to exist. It now feeds the experiment-card secondary line and the agent-handoff prompt, not the card pill. The precedence order now includes `INTERRUPTED`:

```
if any member run is RUNNING:           secondary = RUNNING
else if any member run is FAILED:       secondary = FAILED
else if any member run is INTERRUPTED:  secondary = INTERRUPTED
else if total === 0:                    secondary = PENDING
else if all member runs are FINISHED:   secondary = FINISHED
else:                                   secondary = PENDING
```

`UNKNOWN` is intentionally NOT in the precedence list — it's a parser-fallback, not a real lifecycle state. If a member run has `UNKNOWN` status, it does not contribute to aggregation (treated as if absent for precedence purposes). The roster summary (e.g. `2 running · 5 done · 1 interrupted`) shows raw counts of each non-`UNKNOWN` value; `UNKNOWN` runs are summed separately as `1 unparseable` (or omitted if zero).

**Why this order:** `RUNNING` first — anything still running dominates. `FAILED` next — code failures are the highest-priority follow-up. `INTERRUPTED` then — surface that "the human stopped these" as a visible signal so the user remembers; ranking it above `PENDING` ensures it is never hidden by an experiment that also has not-yet-started runs. `PENDING` and `FINISHED` last because they are the "nothing to look at" terminal states. The user explicitly chose "INTERRUPTED 优先于 FINISHED / PENDING" in the proposal conversation.

### D4. Why bump FS_CONVENTION_VERSION; what the v3→v4 migration does

**Decision:** Bump `FS_CONVENTION_VERSION` from 3 to 4. The v3→v4 migration:

1. **Run READMEs**: not touched. The run-status enum extension is purely additive at the file-format level — every existing v3 README is a valid v4 README without modification. Forward-compat handles old readers (see "Risks" below).
2. **Experiment docs** (`docs/experiments/E*.md`): for each doc, parse the YAML frontmatter; if the `status:` key is missing, insert `status: OPEN` (in the canonical key order — between `tags:` and `created_at:`); if the key exists with a value already in `EXPERIMENT_STATUS_VALUES`, preserve it; if the key exists with an unknown value, log a parse warning and overwrite it with `OPEN`. Write the doc back atomically. Bump the doc's `updated_at` to the migration's timestamp **only when** a real edit occurred (not on a no-op pass).
3. **Version stamp**: write `4` into `docs/.fs-version.json` (or wherever `fs-version-tracking/spec.md` puts the stamp) at the end, only if all per-doc steps succeeded.

**Why bump even though run READMEs are unchanged:** Two reasons.

First, the experiment-doc schema gained a required field. A v3-only reader pointed at a v4 project will find experiment docs with a `status:` key it doesn't expect — current parser tolerates extra keys (no crash) but the field is silently dropped, so the v3 reader can never see the user's lifecycle decision. The version bump is the marker future-readers use to know "you must understand the new field."

Second, the run-status accepted-set widened. A v3-only reader seeing `status: INTERRUPTED` falls into `normalizeStatus`'s `UNKNOWN` branch with a parse warning — acceptable forward-compat behavior, but a meaningful semantic shift that the version stamp documents.

**Migration is no longer a no-op.** It writes to every experiment doc. The migration guide MUST cover the four canonical edge cases (per `fs-migration-guide-authoring/spec.md`):
- Missing `docs/experiments/` directory entirely → migration is no-op for the exp-side step; run-side stamp still bumps.
- Custom user-added frontmatter keys → preserve verbatim; only insert `status:` if missing, never reorder other keys.
- Working tree dirty → runtime refusal; surface `fs-migration-runtime/spec.md`'s standard guidance.
- Concurrent migrations → not the migration's problem; standard caveat per spec.

### D5. UI color palette and lucide-icon mapping

**Decision (run statuses):**

| Status | Badge color (Tailwind / shadcn) | Lucide icon |
|---|---|---|
| `PENDING` | `bg-muted text-muted-foreground border-border` (neutral gray) | `Circle` |
| `RUNNING` | `bg-sky-100 text-sky-800 border-sky-300` (blue) | `Loader2` (spinning) |
| `FINISHED` | `bg-emerald-100 text-emerald-800 border-emerald-300` (green) | `CheckCircle2` |
| `INTERRUPTED` | `bg-amber-100 text-amber-800 border-amber-300` (yellow / amber) | `PauseCircle` |
| `FAILED` | `bg-red-100 text-red-800 border-red-300` (red) | `XCircle` |
| `UNKNOWN` | `bg-rose-50 text-rose-900 border-rose-200` (deeper / muted-red, distinct from `FAILED`) | `HelpCircle` |

**Decision (experiment statuses):**

| Status | Badge color | Lucide icon |
|---|---|---|
| `OPEN` | `bg-sky-100 text-sky-800 border-sky-300` (blue, mirrors `RUNNING`'s family — "active investigation") | `CircleDot` |
| `RESOLVED` | `bg-emerald-100 text-emerald-800 border-emerald-300` (green) | `CheckCircle2` |
| `ABANDONED` | `bg-stone-100 text-stone-800 border-stone-300` (muted gray) | `XCircle` |

**Why these choices:**
- Sky / blue for `RUNNING` and `OPEN` shares a color family because both mean "work is happening / not done." This is a deliberate visual pun — but the icons (`Loader2` spinner vs `CircleDot`) and the labels (`RUNNING` vs `OPEN`) keep them distinguishable.
- Green for `FINISHED` and `RESOLVED` likewise shares a family — both are "successful close." Different icons.
- Amber for `INTERRUPTED` is the standard "needs attention but not an error" color; `PauseCircle` reads as "this was paused by someone" rather than "something broke."
- `UNKNOWN` deliberately uses `rose` (deeper, slightly desaturated red) instead of `red`. The user's instruction was "深一点的灰红 / 橙红." `rose-50` background + `rose-900` text gives a clearly red-family pill that does not collide with `red-100 / red-800` for `FAILED`. `HelpCircle` icon distinguishes it semantically.
- `ABANDONED` uses `stone` (warm gray) rather than `red` to avoid implying anything was wrong. The user articulated `ABANDONED` as "no clean answer / dropped" — the muted gray reads "moved on" not "broke."
- All colors use the 100/800 (or 50/900 for UNKNOWN) shade pair so contrast stays readable in both light and dark mode (shadcn's default theming inverts these).

**Emoji on disk (markdown body, never UI):**
- Run-side: existing emojis preserved (`PENDING 📝`, `RUNNING 🟢`, `FINISHED ✅`, `FAILED ❌`, `UNKNOWN ❓`); new `INTERRUPTED ⏸️`. Considered ⚠️, ⛔, 🟡; ⏸ wins because (a) ⚠️ is already used by stale-RUNNING UI overlay, (b) ⛔ reads as "blocked" not "stopped," (c) 🟡 is what hypotheses use for `PARTIAL`.
- Experiment-side: new emojis `OPEN 🔵`, `RESOLVED ✅`, `ABANDONED ⚫`. The on-disk emoji is **never rendered in the UI** (per `web-layout/spec.md`); it appears only inside the markdown body of `JOURNAL.md` / experiment doc frontmatter pretty-prints for human readability when reading the file directly.

### D6. Counter under the experiment-card title

**Decision:** Replace the existing `<finished> / <total>` counter on the right-hand side of the experiment-card header with a small **secondary line** beneath the title that summarises the run roster:

```
<title>
2 running · 5 done · 1 interrupted    ← secondary line, text-xs text-muted-foreground
```

Counts in the secondary line:
- `running` — runs with `status: RUNNING`
- `done` — runs with `status: FINISHED`
- `interrupted` — runs with `status: INTERRUPTED`
- `failed` — runs with `status: FAILED`
- `pending` — runs with `status: PENDING`
- `unparseable` — runs with `status: UNKNOWN` (shown only when count > 0)

Zero-count categories are omitted from the line entirely. If the experiment has zero member runs, the line reads `no runs yet`. The total count is implicit (sum of the parts) rather than displayed as `<n> / <m>`.

**Why:** With the card pill now reflecting the manual `ExperimentStatus`, the old `<finished> / <total>` counter is no longer needed for the at-a-glance progress signal — the user already sees `OPEN` / `RESOLVED` / `ABANDONED` on the pill. The secondary line answers a different question: "given the manual status, what does the run roster actually look like?" Surfacing all five real categories (omitting zeros) is more informative than just `<finished> / <total>`.

### D7. Doctor lints

**Decision:** Add two new lint codes to `packages/core/src/cli/doctor.ts`:

| Code | Severity | Trigger |
|---|---|---|
| `INTERRUPTED_NO_NOTE` | `info` | Run has `status === 'INTERRUPTED'` and `sections.result` is empty (whitespace-only counts as empty) |
| `RESOLVED_NO_CONCLUSION` | `info` | Experiment has `status === 'RESOLVED'` and `sections.conclusion` is empty (whitespace-only counts as empty) |

**Why:** Symmetric with the existing `FAILED_NO_NOTE` and `MISSING_CONCLUSION` lints. When a user marks a run interrupted or an experiment resolved, they should usually leave a one-liner explaining why / what was concluded. `info` level (not `warn`) is intentional — sometimes the reason is obvious from context and the user shouldn't be nagged.

**Not added** in this change: lint for `ABANDONED` exp without a reason in `## Caveats`. Tentatively unnecessary; can be added later if user feedback supports it.

### D8. Archive becomes a frontmatter field on both run README and exp doc; sidecar deprecated

**Decision:** Add `archived: boolean` to both `RunFrontMatter` and `ExperimentFrontMatter`, default `false`. The frontmatter is the single source of truth post-v4. The legacy `<runDir>/.archived` sidecar is removed by the v3→v4 migration: each pre-existing sidecar is converted into `archived: true` on the corresponding README, then the sidecar file is `unlink`ed.

**Why:** The sidecar approach has three concrete problems the frontmatter avoids:
1. Hidden dot-files don't show up in default `git status` / `ls` output, so users editing a project root don't realise an archive flag exists. Frontmatter is plain text in the same file the user is already editing.
2. The sidecar lives outside the README's mtime-lock concurrency story. Two concurrent agents could write a status update and an archive toggle at the same time without conflict detection. Frontmatter participates in the same optimistic-mtime + content-hash protocol every other field uses.
3. Discovery has to issue an extra `stat()` per run dir to check sidecar presence. Frontmatter reads are free given the README is already parsed.

Adding the field to `ExperimentFrontMatter` is the same shape and gives experiments a first-class archive concept (which v3 lacks entirely — the v2-named `memon experiment archive` actually targets a run dir).

**Migration mechanics:** Per the v3→v4 transform — for each run dir, the migration reads `<runDir>/README.md`, computes `archived = exists('<runDir>/.archived')`, inserts the field into the frontmatter (between `gpus` and `entry` to match the canonical key order), atomically rewrites the README, then `unlink`s the sidecar. If the sidecar is absent, the migration writes `archived: false`. The sidecar deletion is **strictly after** the README write succeeds — if anything fails between, the sidecar remains and the next migration run can retry idempotently (the README would already have `archived: true` from the prior attempt; the migration tolerates the field being already present).

**Forward-compat:** A v3-only reader exposed to a v4 README sees the new `archived:` key as an unknown frontmatter field and silently drops it (current parser tolerates extras). The v3 reader will not find a `.archived` sidecar (the migration deleted it) and will list the previously-archived run as "not archived." This is degraded but non-fatal — the run is still readable, still listed, just no longer hidden by the archive filter. Documented in the migration guide's Edge Cases.

### D9. Hard rule: cannot archive a `RUNNING` run; soft rule: warning on writes to archived items

**Decision:** Two interaction rules between `archived` and the rest of the system:

- **Hard:** Any code path that sets `archived: true` on a run SHALL refuse with `BAD_REQUEST` (CLI exit 2 / web 422) when the run's current `status === 'RUNNING'`. The error message names the rule and points the user at "set status to INTERRUPTED, FINISHED, or FAILED first." No analogous constraint exists for unarchive (always allowed) or for any combination of exp-status with exp-archive (always allowed).
- **Soft:** Any write that targets a run or exp with current `archived: true` (status set, README rewrite, warning add/resolve, link/unlink) SHALL succeed AND emit a warning. CLI surface: write to stderr `warning: <id> is archived; modifying anyway` before the success JSON. Web surface: success response carries `{ ok: true, warning: 'archived', id, ... }`; the React Query mutation handler displays a non-blocking sonner toast with the same message. Reads are silent.

**Why:**
- The user explicitly stated the constraint: "除了不能把 running 状态中的 run 设置为 archived." A RUNNING run is by definition still being touched by something, so archiving it would create a confusing state where the dashboard hides a thing that's actively producing output. Forcing the user to first set a terminal status (INTERRUPTED / FINISHED / FAILED) makes the intent explicit.
- The soft warning on writes-to-archived strikes a balance between "let the user fix typos in archived material" (the user explicitly rejected gating with "如果使用 cli 工具来修改 archived run/exp 的信息，是可以进行操作的，但是会报 warning") and "don't let archived material rot silently when modified by accident."

**Why no exp-status / exp-archive interaction rule:** Symmetric to "no constraint between FINISHED and archived for runs" — once you've decided to archive an exp, the manual exp status (OPEN / RESOLVED / ABANDONED) is independent. Archiving an OPEN exp is fine ("we paused this and don't want it cluttering the dashboard"). Archiving a RESOLVED exp is fine ("filed away as done").

### D10. Frontend listing has two modes: integrated when checkbox checked, segregated when unchecked

**Decision:** Both the experiment-card grid (`/p/<project>`) and run-side listings (sidebar, run-list pages) SHALL render a single "Show archived" checkbox above the listing, defaulting to **unchecked**. Two display modes:

- **Unchecked (default)**:
  - Active items render in the upper section, sorted by the existing rule (e.g. `effective_updated_at` desc for the exp grid).
  - Below the active section, a single muted line `Show <N> archived <experiments|runs>` reveals the archived bucket on click. (Singular/plural agreement: `1 archived experiment` vs `5 archived experiments`.)
  - On click, the archived bucket renders as a separate, visually subdued section below the active list, also sorted by the same rule but disjoint from the active section. The "Show N archived" label updates to `Hide N archived` to allow re-collapse.
- **Checked**:
  - Archived and active items render interleaved in a single sorted list — same sort key, no segregation.
  - The bottom-of-list "Show N archived" affordance is hidden in this mode (it would be redundant — everything is already shown).
  - Archived items remain visually distinguishable via the desaturation overlay from D8.

**Why two modes (not just one):** The user explicitly described the asymmetry: "在显示archived run/exp 的时候，那么 archived run/exp 就显示在其他的 run/exp的中间，按照原定规则排序. 在不显示 archived run/exp 的时候，则在列表底部加一个'显示xx个archived run/exp'，然后所有archived run/exp再一股脑的排在下面." Reasoning: when the user has explicitly opted to see archived material, they want to compare across the full corpus (interleaved sort matches mental model); when they've left the checkbox off, the bottom-of-list bucket is a "remember these exist" affordance that doesn't disrupt the active-item sort. Mixing the two modes would force the user to mentally re-sort whenever they toggle.

**State persistence:** Checkbox state SHALL persist per-project, in the same `localStorage` (or whatever storage) that sidebar / list preferences already use. Reveal state of the bottom-of-list bucket SHALL NOT persist — it resets to collapsed on each page load (so the default unchecked + collapsed state is the reliable "clean view" people anchor on).

**Sidebar rendering:** the sidebar excludes archived experiments entirely — no "Show archived" checkbox, no folded archived bucket, no archived items at all. Archive surfaces ONLY on the main experiment-card grid. Rationale: the sidebar is a quick-jump nav (≤ 5 items typically visible), not an exhaustive list; archived items would just add noise. Users who want to find an archived experiment go to the grid, tick "Show archived" or click the bottom-of-list reveal, and navigate from there.

## Risks / Trade-offs

- **Risk:** Old CLI installs reading new v4 READMEs see `status: INTERRUPTED` as `UNKNOWN`. → **Mitigation:** Standard forward-compat fallback; `normalizeStatus` already produces a parse warning, not a crash. Documented in the migration guide's "Edge Cases" section.
- **Risk:** Old CLI installs reading new v4 experiment docs see the `status:` field but discard it (current parser allows-but-ignores extra frontmatter keys). The v3 user thus loses access to the lifecycle decision. → **Mitigation:** Acceptable degradation; the v3 reader continues to render the card pill from member-run aggregation as before. Documented in the migration guide.
- **Risk:** v3→v4 migration writes to every experiment doc, bumping `updated_at` and producing a noisy git diff. → **Mitigation:** Per D4, the migration writes back **only when** the doc actually lacked the field; no-op passes do not bump `updated_at`. For a project with N experiment docs that all need filling, the diff is bounded to N small frontmatter inserts plus N timestamp bumps; this is a one-time event.
- **Risk:** Users hand-edit a README to set `status: interrupted` (lowercase). → **Mitigation:** `normalizeStatus`'s existing case-fold path covers this; lowercase is normalized to canonical uppercase with a parse warning.
- **Risk:** A user mass-edits multiple runs to `INTERRUPTED` to "clean up the dashboard" and loses signal. → **Mitigation:** `INTERRUPTED_NO_NOTE` lint encourages a why-note; nothing more aggressive (don't gate the write).
- **Risk:** Color choice clashes with the user's terminal color scheme or accessibility preferences. → **Mitigation:** All colors use shadcn's tokenized scales (`bg-emerald-100` etc., not hex), so the design system's dark-mode and contrast behavior is inherited.
- **Risk:** `OPEN` (blue) and `RUNNING` (blue) sharing a color family confuses users who expect "exp pill green = exp pill matches some run is FINISHED." → **Mitigation:** Conscious decision (D5) to use icons + labels for distinction; the color family is a feature ("active work happening / not yet done"), not a bug. The card-grid scenario in `web-dashboard/spec.md` will explicitly include a "card with `OPEN` exp + all-RUNNING members" case to lock the visual.
- **Trade-off:** With manual exp status, an experiment whose member runs all finished cleanly may keep showing `OPEN` until the user remembers to mark it `RESOLVED`. This is by design — the `OPEN → RESOLVED` transition is exactly the human assertion the new field exists to capture. The `RESOLVED_NO_CONCLUSION` lint is the prompting mechanism.
- **Risk:** The v3→v4 migration's run-side step writes to every run README's frontmatter (one-time `archived: false` insert for the majority that have no sidecar). For a project with hundreds of runs this is a noisy commit. → **Mitigation:** Same as the exp-side noise — bounded one-time event; the migration commit is the canonical record. The migration guide's commit message documents what was changed so reviewers don't have to grep the diff. Also: the migration only bumps `updated_at` for runs whose READMEs actually changed shape; in practice this is "every run" on first migration, which is acceptable because the alternative (skip the field, fall back to defaults at parse time) re-introduces the "is this field actually false or just unset" ambiguity D8 is trying to remove.
- **Risk:** A user has unmerged work in progress that touches a run's frontmatter when the v3→v4 migration runs. The migration's atomic README rewrite clobbers the in-flight edit. → **Mitigation:** `fs-migration-runtime/spec.md` already requires a clean working tree in git mode before migration begins; this risk is excluded by the runtime contract. Documented in the migration guide's Edge Cases referring to the runtime spec.
- **Risk:** Sidecar deletion fails (permissions, race) but the README write succeeded → the v3 reader sees both a v4 field AND a sidecar, treating the run as archived twice. → **Mitigation:** The discovery code prefers the frontmatter field as the source of truth post-v4. If the README has `archived: true|false`, the sidecar is ignored. If somehow the README lacks the field but the sidecar exists, the discovery code falls back to the sidecar (this also covers the "user copied a v3 dir into a v4 project" case). The fallback is narrow and tested; documented in `run-discovery/spec.md`'s delta.
- **Risk:** Web client doesn't surface the soft-warning toast prominently enough → user edits archived material thinking it's active. → **Mitigation:** sonner toast is the existing pattern for non-blocking feedback; positioning + duration matches the existing "save succeeded" toast. The desaturation + Archive icon overlay on the card itself is the always-visible secondary signal.

## Migration Plan

1. Land code changes in this order (each independently builds & passes tests):
   - `packages/core` types: run + exp enums, `ExperimentStatus`, `ExperimentFrontMatter` gains `status` and `archived`, `RunFrontMatter` gains `archived`
   - parsers / serializers / normalizers for the new fields
   - `packages/core/migrations/v3-to-v4.md` and runtime fs-migration recognising v4 with the dual transform (exp doc OPEN-fill + run README sidecar→frontmatter + sidecar deletion)
   - Discovery layer: source `archived` from frontmatter; sidecar fallback gated to "README lacks the field" only
   - CLI accept new values: `memon run status set --to INTERRUPTED`, `memon experiment status set --to OPEN|RESOLVED|ABANDONED`
   - CLI archive subcommands (`memon run archive`, `memon run unarchive`, exp equivalents) rewired to write frontmatter; refuse `archive` on RUNNING runs; emit warning when target is already archived
   - Web `StatusPill` (extended for both enums) + experiment-card pill+secondary-line refactor + archive desaturation overlay + "Show archived" checkbox + segregated/integrated listing modes
   - Doctor lints (`INTERRUPTED_NO_NOTE`, `RESOLVED_NO_CONCLUSION`)
2. Bump `FS_CONVENTION_VERSION = 4` is the **last** code-side step before tests, so partially-applied work doesn't leave the codebase advertising v4 without the supporting code in place.
3. On user's machines, the next time `memon` is run inside a v3 project the migration prompts (per `fs-migration-runtime/spec.md`'s standard flow). User confirms; migration walks experiment docs (insert `status: OPEN` and `archived: false` if missing), then run dirs (insert `archived: <derived>`, delete sidecar), then writes the version stamp.
4. Optional follow-up (separate change): update agent skills to teach them about `INTERRUPTED`, `OPEN` / `RESOLVED` / `ABANDONED`, and the new archive frontmatter flow. Tracked separately under the split-runtime-then-skills convention.

**Rollback:** revert the `FS_CONVENTION_VERSION` bump and the type / parser additions. Any experiment docs that already have `status:` / `archived:` will be silently ignored by the rolled-back parser (extra-key tolerance). Run READMEs with `status: INTERRUPTED` are read as `UNKNOWN` (parse warning). Run READMEs with `archived: true` whose sidecars were deleted by the migration will appear "not archived" to the rolled-back code — to recover archive state from a rolled-back position, the user (or a future re-roll-forward) re-creates `<runDir>/.archived` for each run with `archived: true` in the README. The migration guide's Rollback Notes section documents this recovery path explicitly.

## Open Questions

- Should the journal `[STATUS]` event include experiment-status transitions, or do we add a separate `[EXP_STATUS]` event tag? → **Tentatively** introduce `[EXP_STATUS]` as a new tag; keeping `[STATUS]` run-only avoids ambiguity in the body parsing (run dirs and exp ids are distinguishable by prefix, but cleanly separating tags is simpler). Will be specced in `journal/spec.md` delta.
- Should the experiment status picker `<Select>` in the web UI also include `UNKNOWN` for the run picker? → **No.** `UNKNOWN` is parser-only and never user-selectable for runs; same exclusion logic applies to the new exp picker (which has no `UNKNOWN` value at all).
- Should `memon doctor` lint experiments whose `status` is `RESOLVED` but whose member runs all show `FAILED`? (i.e., user said "resolved" but the runs didn't actually succeed) → **Tentatively no** for this change; the user knows what they declared. Listed here so the apply phase doesn't accidentally implement it.
