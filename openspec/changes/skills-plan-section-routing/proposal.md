## Why

`add-experiment-plan-section` shipped a new `## Plan` H2 section on v3 experiment docs (between `Method` and `Conclusion`), supporting GFM task lists. The proposal explicitly left skills updates as a follow-up. Without it, the existing three failure modes the Plan section is meant to fix will keep happening:

1. Agents write forward-looking TODOs into `## Method` (polluting the methodology reference).
2. Agents fabricate `## Conclusion` content per-run because the section nominally needs *something* (degrading the trustworthiness of Conclusion).
3. Per-run learnings have no canonical home — they leak into Method, Conclusion, or `docs/journal.md` `[NOTE]` events instead of accumulating coherently beside the experiment.

This change updates the three skills that touch experiment doc sections (`memon-run-experiment`, `memon-write-script`, `memon-propose`) so they know `## Plan` is the canonical home for forward-looking TODOs and per-run reflections.

## What Changes

### `memon-run-experiment/SKILL.md`

- **§0 (Identify or create the parent experiment doc)**: when proposing a new exp, mention `## Plan` alongside `Motivation` / `Method` as an optional third piece for the initial body. If the user has explicit "next things to try" before any run lands, those become initial `- [ ]` task items in Plan, not bullets in Method.
- **§9 (Terminal — success path)**: rewrite the "walk the user through in Chinese" bullet that currently maps "结论 / 怎么影响假说" → `## Conclusion`. New mapping:
  - **Defensible cross-run conclusion exists** → write/update `## Conclusion`.
  - **Per-run learning, not yet defensible** → add a reflection sub-bullet under the relevant `## Plan` task item; promote to Conclusion later when the cross-run pattern is clear.
  - **Plan task is now done** → flip `- [ ]` to `- [x]` on that task.
- **§9 closing paragraph "Every cross-run insight has a deterministic home"**: rewrite. Plan is the new default home for per-run insights that don't fit Method or Caveats. `docs/journal.md` `[NOTE]` is reserved for cross-cutting observations that don't belong to any single experiment.
- **§9 add a "Consider FINISHED?" check**: after writing the run README + updating Plan/Conclusion/Caveats, if all `[ ]` in `## Plan` are now `[x]` AND every member run is terminal (FINISHED or FAILED, not RUNNING) AND `## Conclusion` is non-empty, surface to the user "this experiment looks ready to mark FINISHED — do you want me to flip its status?". This is a *signal*, not an auto-promote.
- **§12 (Post-run anomaly review)**: brief note distinguishing Plan reflections (per-run learnings that feed Conclusion later) from Warnings (anomalies requiring human adjudication) — they're different surfaces, not competing.

### `memon-write-script/SKILL.md`

- **Branch 2 (Experiment implied but no doc yet)**: when discussing initial body content with the user, the recommendation `Method MAY start as a single sentence — the script registry line will be appended to it after the script is written` stays. Add: **if the user has forward-looking ideas like "next try X / Y / Z", those go in `## Plan` as `- [ ]` task items, not in Method**. Method describes methodology; Plan holds TODOs.

### `memon-propose/SKILL.md`

- **§1 (Snapshot the project)**: extend the list of things read. Currently reads hypotheses + recent experiments + journal events + recent digests / reports. Add: **also read each relevant exp doc's `## Plan` section**.
- **§4 / §5 (Diverge / Converge)**: when proposing experiments, treat already-`[ ]`-listed Plan items as strong priors — surface that they're already-planned (so the user can directly resume them) rather than re-proposing them as net-new. Net-new proposals SHOULD be either (a) something not currently in any exp's Plan, or (b) an explicit alternative-to-X with rationale why we're considering replacing an existing Plan item.

Out of scope:
- Adding any CLI surface for editing Plan (the runtime change already settled this: web Edit markdown dialog or direct file edit).
- Modifying `memon-digest-journal`, `memon-write-report`, `memon-append-journal`, `memon-append-warning`, `memon-migrate-fs` — they don't directly write experiment doc body sections.
- Adding the new `memon-drive` skill — that's a separate change (`skills-add-drive`).
- Changing `disable-model-invocation` flags — that's a separate change (`skills-allow-model-invocation`).

Acceptance gate:
- `grep -n "Plan" packages/skills/memon-run-experiment/SKILL.md` returns multiple matches in §0, §9, §12.
- `grep -n "Plan" packages/skills/memon-write-script/SKILL.md` returns a match in the Branch 2 area.
- `grep -n "Plan" packages/skills/memon-propose/SKILL.md` returns matches in §1 (snapshot) and §4/§5 (diverge/converge).
- The §9 "Every cross-run insight has a deterministic home" paragraph no longer claims `docs/journal.md` `[NOTE]` as the catch-all home — Plan is.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `memon-skills`: ADD a requirement that skills writing into experiment doc bodies treat `## Plan` as the canonical home for forward-looking TODOs and per-run reflections, distinct from `Method` (stable methodology) and `Conclusion` (defensible cross-run findings only).

## Impact

- **Code**: none.
- **Docs / skill bodies**: 3 SKILL.md files (`memon-run-experiment`, `memon-write-script`, `memon-propose`).
- **Specs**: delta on `memon-skills`.
- **No runtime changes**: pure skill content edits.
- **Migration risk**: low. Agents reading the new skill bodies will route content correctly. Agents that still read older versions (e.g. cached in some external system) keep writing the old way — no regression, just slower convergence.
