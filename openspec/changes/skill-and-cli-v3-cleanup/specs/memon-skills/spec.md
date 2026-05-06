## ADDED Requirements

### Requirement: Skill body assumes v3 — version branching consolidated to a tail section

Skill SKILL.md body content SHALL assume the project is at the
current `FS_CONVENTION_VERSION` (v3 as of this change). Inline
"if v3 do X, if v2 do Y" branches are forbidden in the body —
the preflight `memon fs-version check` already catches projects on
older versions and points the agent at `memon-migrate-fs`.

When a skill needs to give the agent guidance for legacy
projects (detection of an older shape, when to invoke the
migration skill, how to phrase the consent prompt to the user),
that guidance SHALL be consolidated into a single
`## Migration helpers (legacy projects only)` section at the END
of the SKILL.md, after the main workflow.

The body sections preceding the migration helpers SHALL NOT
contain the strings `v2`, `v3`, or `FS_CONVENTION_VERSION` (case-
insensitive) outside of code blocks.

#### Scenario: memon-append-warning body has no v2/v3 mentions
- **WHEN** reviewing `packages/skills/memon-append-warning/SKILL.md`
  body content (everything before the optional migration helpers
  section)
- **THEN** the body contains no occurrence of the literal strings
  `v2`, `v3`, or `FS_CONVENTION_VERSION` outside fenced code blocks

#### Scenario: memon-run-experiment body has no v2/v3 mentions
- **WHEN** reviewing `packages/skills/memon-run-experiment/SKILL.md`
  body content (everything before `## Migration helpers (legacy
  projects only)`)
- **THEN** the body contains no occurrence of the literal strings
  `v2`, `v3`, or `FS_CONVENTION_VERSION` outside fenced code blocks

#### Scenario: Migration helpers exists at the end
- **WHEN** reviewing `packages/skills/memon-run-experiment/SKILL.md`
- **THEN** the file contains a `## Migration helpers (legacy
  projects only)` H2 section at or near the end of the document
  consolidating any legacy-project guidance

### Requirement: Warnings always target the parent experiment doc

The `memon-append-warning` skill SHALL invoke
`memon experiment warning add <exp-id> --run <run-dir> ...` (or the
convenience form `memon run warning add <run-dir> ...` defined in
the `memon-cli` capability). The skill SHALL NOT invoke
`memon experiment warning add <run-dir>` (the legacy form that
writes to a run README) — every warning lands on the parent exp
doc's `## Warnings` table with the originating run named in the
`Run` column.

The skill SHALL NOT include any guidance assuming v2 6-col
warnings tables exist on disk; the parser tolerates v2 6-col reads
for back-compat but the skill MAY assume any project at the
current convention version has been migrated.

When the run is orphan (`frontMatter.experiment` is null/empty),
the skill SHALL refuse to add the warning and SHALL prompt the user
to first bind the run via `memon experiment link`. The skill MUST
NOT silently fall back to writing on the run README, and MUST NOT
auto-create an exp doc.

#### Scenario: Bound run dispatches to exp doc
- **GIVEN** a run `foo-260501-100000` with `experiment: E0001-foo`
- **WHEN** the skill is invoked to add a `result`-category warning
- **THEN** the resulting CLI invocation targets the exp doc
  (either `memon experiment warning add E0001-foo --run
  foo-260501-100000 ...` OR `memon run warning add
  foo-260501-100000 ...`); the warning row appears in
  `docs/experiments/E0001-foo.md`'s `## Warnings` table with the
  `Run` column populated

#### Scenario: Orphan run blocks the warning
- **GIVEN** a run `bar-260501-100000` with no `experiment:` field
- **WHEN** the skill is invoked to add a warning
- **THEN** the skill DOES NOT issue any warning-write CLI call;
  the skill surfaces an instruction to the user to first run
  `memon experiment link <exp-id> bar-260501-100000`

### Requirement: Post-run content routes to deterministic exp-doc sections

The `memon-run-experiment` skill SHALL route every kind of cross-run
insight produced by the terminal-success step (currently §10) to a
named section on the parent exp doc. There MUST NOT be a "如果两
边都没合适的位置写" (or any equivalent loose-routing) bullet.

The mapping SHALL be:

| Content kind | Destination |
|---|---|
| 改动了什么 (what was changed in this run) | run README's `## Setup` |
| 主要结果 (this run's primary result) | run README's `## Result` |
| 结论 / 怎么影响关联的假说 (cross-run conclusion) | parent exp doc's `## Conclusion` |
| 实现思路 / 设计 rationale (cross-run) | parent exp doc's `## Method` |
| 让用户注意的细节 / caveat / interpretive limit (cross-run) | parent exp doc's `## Caveats` |
| 添加的警告 (rows §12 added) | already on the exp doc's `## Warnings`; just summarise to the user |

#### Scenario: Implementation rationale lands on exp Method
- **GIVEN** a successful run whose impl required a non-trivial
  design choice (e.g. "switched optimizer from AdamW to Lion to
  avoid memory regression")
- **WHEN** the agent walks §10's content-routing checklist
- **THEN** the rationale is appended to the parent exp doc's
  `## Method` section via `memon experiment readme write`, not
  written to the run README, and not surfaced into a third
  freeform location

#### Scenario: Interpretive caveat lands on exp Caveats
- **GIVEN** a successful run with a caveat readers should know
  (e.g. "loss spike at step 1500 is recoverable; eval still
  meaningful")
- **WHEN** the agent walks §10's content-routing checklist
- **THEN** the caveat is appended to the parent exp doc's
  `## Caveats` section, not the run README

### Requirement: memon-write-script identifies and binds to a parent experiment

The `memon-write-script` skill SHALL begin its workflow with a
"Identify the parent experiment" step, branching on three cases:

1. **Exp explicitly named** — user references an exp doc by id or
   slug. The skill SHALL read the exp doc's current `## Method`
   section before writing the script, and SHALL append the new
   script's relative path + one-sentence purpose to that section
   after the script is written, in the canonical line format
   `- \`<rel-path>\` — <description>`.

2. **Exp implied but absent** — user describes an experiment
   ("write a script for the zero-SNR sweep") but no matching exp
   doc exists. The skill SHALL ask the user (in Chinese, per
   skill convention) whether to create the exp doc, and if yes
   SHALL discuss the initial Motivation / Method content with
   the user before calling `memon experiment create`. After
   creation, the script gets registered per case 1.

3. **No exp context** — user explicitly says "just write the
   script, no exp doc." The skill SHALL skip exp doc handling
   entirely; the script SHALL NOT carry an exp-binding comment
   and no exp readme write happens.

The skill's existing prohibition on the script writing the run
README ("README authorship is exclusive to memon-run-experiment"
requirement) is unchanged.

#### Scenario: Existing exp gets script appended to Method
- **GIVEN** an exp doc `E0001-fsdp` with an existing `## Method`
  section
- **WHEN** the user asks `memon-write-script` to write a script
  for E0001-fsdp
- **THEN** the script is written to its target location AND the
  exp doc's `## Method` body gains a new line `- \`<script-path>\`
  — <description>`; the existing Method content is preserved

#### Scenario: User declines exp doc creation
- **GIVEN** the user describes an experiment without naming an
  existing exp
- **WHEN** the skill asks "create exp doc?" and the user says no
- **THEN** the script is written without an exp-binding comment;
  no `memon experiment create` call happens; no exp readme write

#### Scenario: User accepts exp doc creation
- **GIVEN** the user describes an experiment without naming an
  existing exp
- **WHEN** the skill asks "create exp doc?" and the user says
  yes, then provides initial Motivation/Method content
- **THEN** the skill calls `memon experiment create <slug>
  --title "<title>"`, then writes the initial Method body via
  `memon experiment readme write`, then writes the script and
  appends its registry line to Method
