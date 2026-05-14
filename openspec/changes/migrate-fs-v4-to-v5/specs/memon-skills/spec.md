## ADDED Requirements

### Requirement: SKILL.md files SHALL reference the v5 folder-based experiment doc layout

Every `packages/skills/memon-*/SKILL.md` body that mentions the experiment doc's on-disk location SHALL spell it as `<projectRoot>/docs/experiments/E<NNNN>-<slug>/README.md` (post-v5 folder-based form) rather than `<projectRoot>/docs/experiments/E<NNNN>-<slug>.md` (legacy v4 file form). The same rule applies to `packages/skills/README.md` and any other documentation under `packages/skills/`.

This applies to: literal path examples, code blocks, anti-pattern bullets, section-routing tables, and any prose. Path strings in shell snippets that invoke memon CLI subcommands (which take an id, not a path) are unaffected.

#### Scenario: No SKILL.md body references the legacy file-form path
- **WHEN** a reader runs `grep -lE 'docs/experiments/E[^/]+\.md' packages/skills/memon-*/SKILL.md packages/skills/README.md`
- **THEN** the output is empty (no file matches)

#### Scenario: Folder-based path appears in at least one skill body
- **WHEN** a reader runs `grep -lE 'docs/experiments/E.*/README\.md' packages/skills/memon-*/SKILL.md`
- **THEN** the output contains at least the skill files that reference the experiment doc path

### Requirement: `memon-run-experiment` run README schema reminders SHALL match the v5 canonical section policy

The "Run README schema reminders" paragraph (or equivalent) in `packages/skills/memon-run-experiment/SKILL.md` SHALL describe the post-v5 canonical run-side section list:

- Required: `Setup`, `Result`, `Artifacts`.
- Optional: `Motivation`. Rendered by the web UI when present; absent is fine.
- Forbidden on the run side:
  - `Method` — content belongs in `## Setup` of the same run (methodology refinements are part of setup).
  - `Conclusion` — content belongs in `## Result` of the same run (per-run findings).
  - `Caveats` — content belongs on the parent exp doc's `## Caveats`.
  - Legacy `Warnings`, `New Hypotheses` (unchanged from prior policy).

The body SHALL include anti-pattern bullets under `## Anti-patterns` for each of the three forbidden non-legacy headings (`Method`, `Conclusion`, `Caveats`), each citing the parse-warning code (`RUN_HAS_METHOD` / `RUN_HAS_CONCLUSION` / `RUN_HAS_CAVEATS`) and the correct relocation destination.

#### Scenario: Schema reminders describe the four-section canonical
- **WHEN** a reader inspects the run README schema reminders section of `memon-run-experiment/SKILL.md`
- **THEN** the text names `Motivation` as the sole optional run-side section that gets rendered when present
- **AND** the text names `Method` / `Conclusion` / `Caveats` as forbidden on the run side
- **AND** the text states the relocation destinations: Method → run's Setup, Conclusion → run's Result, Caveats → parent exp doc

#### Scenario: Anti-patterns forbid the three non-legacy bad headings on run README
- **WHEN** a reader inspects the `## Anti-patterns` section of `memon-run-experiment/SKILL.md`
- **THEN** at least three bullets each forbid writing one of (`## Method`, `## Conclusion`, `## Caveats`) content on a run README
- **AND** each bullet names the relocation destination or the parse-warning code

### Requirement: `memon-run-experiment` SHALL specify `entry:` is a project-root-relative path

The Phase 1 README write block + Phase 2 README expansion block in `packages/skills/memon-run-experiment/SKILL.md` SHALL document the `entry:` frontmatter field as a path **relative to the project root** (NOT relative to the script, NOT absolute, NOT relative to the run dir).

The field SHALL be illustrated with a concrete example like `entry: scripts/erdos/run.sh`.

#### Scenario: Skill body specifies the entry-path convention
- **WHEN** a reader inspects the `entry:` line in the Phase 1 README template inside `memon-run-experiment/SKILL.md`
- **THEN** the line is annotated or commented to say the path is relative to the project root
- **AND** the example value visible to the reader is a relative path like `scripts/<area>/<name>.sh` (no leading `/`, no `..`)

### Requirement: SKILL.md files SHALL warn against custom H2 sections

At least one skill that writes to spec files (`memon-drive`, `memon-run-experiment`, or `memon-write-script`) SHALL contain an anti-pattern bullet stating that creating a custom H2 section (not in the canonical list) produces an `UNKNOWN_H2_SECTION` parse warning. The bullet SHALL advise the agent to either (a) rename the heading to a canonical section name, (b) drop the content if it doesn't belong, or (c) accept the warning explicitly if the custom section is intentional.

#### Scenario: At least one skill warns against custom H2 sections
- **WHEN** a reader runs `grep -lE 'UNKNOWN_H2_SECTION|custom H2|non-canonical heading' packages/skills/memon-*/SKILL.md`
- **THEN** the output contains at least one path
