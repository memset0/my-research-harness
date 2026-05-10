## ADDED Requirements

### Requirement: Skills writing to experiment doc bodies SHALL route content per the canonical section model

Every memon skill that writes (creates, appends to, or edits) a v3 experiment doc body section SHALL treat the six canonical H2 sections as semantically distinct, with content routed as follows:

| Section | What goes in | What does NOT go in |
|---|---|---|
| `## Motivation` | Why this experiment exists; problem statement | Methodology; results; TODOs |
| `## Method` | Stable methodology description; list of contributing scripts | Forward-looking TODOs ("next try X"); per-run learnings |
| `## Plan` | Forward-looking task items (`- [ ]` / `- [x]`); per-run reflection sub-bullets under the relevant task | Defensible cross-run conclusions; stable methodology |
| `## Conclusion` | Defensible cross-run findings, written only when the cross-run pattern is clear | Per-run learnings that haven't yet generalised; "pending" filler when nothing defensible can be said |
| `## Caveats` | Cross-run interpretation limits; "be careful about X when reading these results" | Per-run mid-flight observations |
| `## Warnings` | `[OPEN]` rows flagged by `memon experiment warning add` (or `memon run warning add`) | Anything else |

Skills SHOULD treat `## Plan` as the default home for per-run learnings that don't yet generalise. Skills SHOULD NOT route per-run observations into `docs/journal.md` as `[NOTE]` events unless the observation is genuinely cross-cutting (touches multiple experiments) and doesn't belong on any single experiment.

A "defensible cross-run conclusion" is one where at least two runs in the experiment's `runs[]` produced consistent evidence in the same direction. A skill SHOULD NOT promote a per-run learning to `## Conclusion` until that bar is met; until then, it lives as a Plan reflection sub-bullet.

#### Scenario: `memon-run-experiment` §9 walkthrough routes per-run vs. cross-run insights correctly
- **WHEN** `memon-run-experiment`'s §9 success-path "walk the user through in Chinese" section is inspected
- **THEN** it contains a bullet covering "what this run taught us" that branches on `defensible cross-run conclusion` (write `## Conclusion`) vs. `not-yet-defensible per-run learning` (add as a `## Plan` reflection sub-bullet under the relevant task)
- **AND** it includes a bullet covering "flip the Plan task to `[x]` if this run completed it"

#### Scenario: `memon-run-experiment` §9 surfaces the FINISHED-readiness signal
- **WHEN** `memon-run-experiment`'s §9 is inspected
- **THEN** after writing the run README + updating Plan/Conclusion/Caveats, the body instructs the agent to check: all `[ ]` in `## Plan` now `[x]`; every member run is in a terminal state; `## Conclusion` is non-empty
- **AND** the body explicitly frames this as a *signal* the agent surfaces to the user for confirmation, NOT an automatic state transition

#### Scenario: `memon-write-script` Branch 2 routes user TODOs to `## Plan`, methodology to `## Method`
- **WHEN** `memon-write-script`'s "Identify the parent experiment" → Branch 2 section is inspected
- **THEN** the section instructs the agent to write forward-looking ideas the user mentions ("next try X / Y / Z") into the new exp doc's `## Plan` as `- [ ]` task items
- **AND** it instructs the agent that the script registry line (the `- \`scripts/foo/run.sh\` — ...` bullet) goes in `## Method` (script registration is methodology)

#### Scenario: `memon-propose` reads `## Plan` as a prior
- **WHEN** `memon-propose`'s §1 (Snapshot the project) is inspected
- **THEN** the list of things the skill reads includes each relevant exp doc's `## Plan` section
- **AND** the diverge / converge sections instruct the agent to treat already-`[ ]`-listed Plan items as strong priors — to surface them as "already-planned, can be resumed" rather than re-propose them as net-new

#### Scenario: `## Plan` is the catch-all home, not `docs/journal.md`
- **WHEN** `memon-run-experiment`'s §9 closing paragraph (the one describing where insights have a deterministic home) is inspected
- **THEN** `## Plan` is named as the home for per-run insights that don't fit `## Method` or `## Caveats`
- **AND** `docs/journal.md` `[NOTE]` is described as the home for cross-cutting observations that don't belong to any single experiment (not as a generic fallback)
