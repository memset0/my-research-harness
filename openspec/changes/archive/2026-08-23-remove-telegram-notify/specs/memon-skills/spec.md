## ADDED Requirements

### Requirement: Skill invocation policy split by risk tier

The bundled skills under `packages/skills/memon-*/` SHALL declare invocation
control via the `disable-model-invocation` frontmatter field according to their
confirmation boundary. `memon-migrate-fs` SHALL set
`disable-model-invocation: true` because it rewrites the full project convention
and can create migration commits. Every other bundled skill MAY omit the field
and be selected when its description matches, while still obeying the
confirmation rules documented in its body.

At archive time the model-invocable set is `memon-drive`,
`memon-write-experiment-doc`, `memon-write-script`, `memon-run-experiment`,
`memon-append-journal`, `memon-digest-journal`, `memon-write-report`,
`memon-write-code-review`, and `memon-propose`.

#### Scenario: Run-experiment allows model invocation

- **WHEN** a reader inspects the frontmatter of
  `packages/skills/memon-run-experiment/SKILL.md`
- **THEN** no `disable-model-invocation` field is present (or the field is
  `false`)

#### Scenario: Migrate-fs is user-invoked

- **WHEN** a reader inspects the frontmatter of
  `packages/skills/memon-migrate-fs/SKILL.md`
- **THEN** it contains the line `disable-model-invocation: true`

#### Scenario: Append-journal allows model invocation

- **WHEN** a reader inspects the frontmatter of
  `packages/skills/memon-append-journal/SKILL.md`
- **THEN** no `disable-model-invocation` field is present (or the field is
  `false`)

### Requirement: `--project-root` is always passed explicitly

Every `memon ...` invocation issued from a skill body SHALL pass
`--project-root <path>` (or `--project-root .`) explicitly. Skills SHALL NOT rely
on the CLI's implicit-cwd fallback. This forces every skill to be portable
across project cwd and configuration layouts and removes the
silent-cwd-default class of bugs.

#### Scenario: Append-journal example uses --project-root

- **WHEN** reviewing the example invocation in
  `packages/skills/memon-append-journal/SKILL.md`
- **THEN** the command includes `--project-root .` (or
  `--project-root <path>`) explicitly

### Requirement: Doctor checks fold into memon-digest-journal; no standalone memon-doctor skill

There SHALL NOT be a standalone `memon-doctor` skill. Doctor checks (running the
`memon doctor` CLI and walking the user through fixes) SHALL be performed inside
`memon-digest-journal`'s workflow before the cursor advance. The `memon doctor`
CLI command itself is preserved for ad-hoc checks but no longer has a dedicated
skill wrapper.

The rationale is that integrity-sweep and cursor-advance share a natural commit
point. Splitting them creates a "ran doctor, fixed things, forgot to digest"
failure mode.

#### Scenario: digest-journal includes the doctor sweep

- **WHEN** reviewing `packages/skills/memon-digest-journal/SKILL.md` workflow
- **THEN** it includes a step that runs
  `memon doctor --project-root . --format json` and walks the user through each
  issue with the documented doctor codes

#### Scenario: Bundled skill inventory excludes removed wrappers

- **WHEN** listing `packages/skills/memon-*` directories
- **THEN** there is no `memon-doctor/`, `memon-append-warning/`, or
  `memon-notify/` subdirectory
- **AND** the only bundled directories are `memon-drive`,
  `memon-write-experiment-doc`, `memon-write-script`,
  `memon-run-experiment`, `memon-append-journal`, `memon-digest-journal`,
  `memon-write-report`, `memon-write-code-review`, `memon-propose`, and
  `memon-migrate-fs`

### Requirement: `memon-write-code-review` exists as a model-invocable code-review authoring skill

A bundled skill at `packages/skills/memon-write-code-review/SKILL.md` SHALL
exist. It authors a single code-review doc per invocation at
`<projectRoot>/docs/code-review/<YYYY-MM-DD>-<slug>.md` (project-wide) or
`<projectRoot>/docs/experiments/E<NNNN>-<slug>/code-review/<YYYY-MM-DD>-<slug>.md`
(experiment-scoped). It SHALL be model-invocable (no
`disable-model-invocation: true` field, or `false`) — one low-stakes markdown
write, the same tier as `memon-write-report`. The skill body SHALL be English
with any user-facing dialogue in Chinese inside `>` block quotes.

The skill body SHALL document the frontmatter contract the runtime parses:
`title`, `description`, `experiment` (`E<NNNN>-<slug>` or null), `created_at` /
`updated_at` (ISO8601 with timezone offset), `commits[]` (each `repo`, `sha`,
`url`, optional `subject`, and `reviewed`), and `review_todolist[]` (each `item`
and `done`). It SHALL state that completion is derived (the human checks the
boxes in the dashboard) and that the agent writes every `reviewed` / `done` flag
as `false`.

The skill body SHALL give a submodule-aware recipe for the per-commit `url` and
for in-body line-level permalinks: each link uses the owner/repo and `sha` of the
repo the file lives in (the main repo or the specific submodule), with the
`<path>` relative to that repo's root; the commit URL is `…/commit/<sha>` and the
line permalink is `…/blob/<sha>/<path>#L<a>-L<b>`.

The skill body SHALL document the body template: `## Requirement`,
`## Changes`, `## Verification`, `## Notes`, with each change in `## Changes`
titled in Conventional Commits style and carrying the H4 subsections
Deliverables, Design Decisions, Analysis, Verification, and Details (write
"None" when empty). It SHALL instruct: `Analysis` is a complete, end-to-end
walk-through of the change (substantial, not one or two lines) that weaves
together essential code excerpts, line-level permalinks, pseudocode, and math
(`$…$` / `$$…$$`); keep raw code minimal (link full code via permalink, never
paste whole files) without shortening the walk-through; go deep on the "why" in
`Design Decisions` (underlying root cause and relevant math); label pseudocode
with a sentence before the fenced block. It SHALL instruct the agent to consult
the user via AskUserQuestion (or a plain question where that tool is
unavailable) when the change-split granularity is ambiguous, and SHALL frame the
sections as angles to consider rather than a rigid template (omit what does not
apply; extra content is allowed).

The skill SHALL preflight-check the FS convention version per
`../PREFLIGHT.md`, and SHALL appear in `packages/skills/README.md` (the
skill-selection matrix and the files-written table).

After successfully writing the document, the skill SHALL tell the user in the
active conversation that the code-review is ready and include the created or
updated path. Completion SHALL NOT depend on an out-of-band notification
command or transport.

#### Scenario: Skill exists with model-invocable frontmatter

- **WHEN** a reader inspects
  `packages/skills/memon-write-code-review/SKILL.md`
- **THEN** the frontmatter has `name: memon-write-code-review` and contains no
  `disable-model-invocation: true` line (the field is absent or `false`)

#### Scenario: Documents both scope locations

- **WHEN** a reader inspects the file-naming section
- **THEN** both the project-wide `docs/code-review/` and the experiment-scoped
  `docs/experiments/E<NNNN>-<slug>/code-review/` locations appear, with the
  `<YYYY-MM-DD>-<slug>` filename shape

#### Scenario: Submodule-aware permalink recipe

- **WHEN** a reader inspects the GitHub-link guidance
- **THEN** it specifies per-repo owner/sha and a `<path>` relative to the owning
  repo's root for both the `/commit/<sha>` and
  `blob/<sha>/<path>#L<a>-L<b>` forms

#### Scenario: Body template with conventional-commit change titles and five subsections

- **WHEN** a reader inspects the body template
- **THEN** the sections Requirement / Changes / Verification / Notes appear,
  and each change carries the five H4 subsections (Deliverables, Design
  Decisions, Analysis, Verification, Details)

#### Scenario: Listed in the skills index

- **WHEN** a reader inspects `packages/skills/README.md`
- **THEN** `memon-write-code-review` appears in the skill-selection matrix and
  in the files-written table

#### Scenario: Skill body language conventions

- **WHEN** a reader samples headings and paragraphs from the skill body
- **THEN** all sampled prose is in English, and any user-facing dialogue appears
  in Chinese inside `>` block quotes

#### Scenario: Code-review completion is conversational

- **WHEN** `memon-write-code-review` finishes writing a doc
- **THEN** the agent tells the user in the active conversation that the review
  is ready and provides its path
- **AND** no notification command is invoked

## REMOVED Requirements

### Requirement: Legacy skill invocation policy split by risk tier

**Reason**: The previous policy enumerated the removed `memon-notify` and
`memon-append-warning` wrappers and retained scenarios for both. Replacing the
requirement removes those obsolete inventory entries while preserving the
current model-invocation boundary.

**Migration**: Keep `memon-migrate-fs` explicitly user-invoked and allow the
remaining bundled skills to follow their own documented confirmation rules.

### Requirement: Legacy --project-root exception policy

**Reason**: The previous requirement contained a sole exception for
`memon-notify`, including a scenario that required the removed skill to invoke
the removed command without `--project-root`.

**Migration**: Every remaining bundled skill passes `--project-root`
explicitly when invoking `memon`.

### Requirement: Legacy doctor skill inventory

**Reason**: The previous inventory scenario still enumerated removed wrappers,
including `memon-notify`, and therefore no longer described the bundled set.

**Migration**: Use the ten-skill inventory in the replacement doctor/digest
requirement; strict installation synchronization removes stale wrappers.

### Requirement: Legacy memon-write-code-review notification contract

**Reason**: The previous code-review requirement mandated an out-of-band
Telegram completion notification and contained a scenario that invoked the
removed command.

**Migration**: Report the created or updated code-review path in the active
conversation after all document writes and links complete.

### Requirement: `memon-notify` exists as a model-invocable push-notification skill

**Reason**: Telegram is no longer supported and the corresponding CLI surface
is removed, so retaining an invocable wrapper would direct agents to a dead
capability.

**Migration**: Re-run `memon install-skills`; strict synchronization removes
previously installed `memon-notify` directories. Agents use the active
conversation for completion, failure, and question handoffs.

## RENAMED Requirements

- FROM: `### Requirement: Skill invocation policy split by risk tier`
- TO: `### Requirement: Legacy skill invocation policy split by risk tier`
- FROM: ### Requirement: `--project-root` is always passed explicitly
- TO: `### Requirement: Legacy --project-root exception policy`
- FROM: `### Requirement: Doctor checks fold into memon-digest-journal; no standalone memon-doctor skill`
- TO: `### Requirement: Legacy doctor skill inventory`
- FROM: ### Requirement: `memon-write-code-review` exists as a model-invocable code-review authoring skill
- TO: `### Requirement: Legacy memon-write-code-review notification contract`
