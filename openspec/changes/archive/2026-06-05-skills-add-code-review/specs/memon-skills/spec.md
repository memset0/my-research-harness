## ADDED Requirements

### Requirement: `memon-write-code-review` exists as a model-invocable code-review authoring skill

A bundled skill at `packages/skills/memon-write-code-review/SKILL.md` SHALL
exist. It authors a single code-review doc per invocation at
`<projectRoot>/docs/code-review/<YYYY-MM-DD>-<slug>.md` (project-wide) or
`<projectRoot>/docs/experiments/E<NNNN>-<slug>/code-review/<YYYY-MM-DD>-<slug>.md`
(experiment-scoped). It SHALL be model-invocable (no `disable-model-invocation`
field, or `false`) — one low-stakes markdown write, the same tier as
`memon-write-report`. The skill body SHALL be English with any user-facing
dialogue in Chinese inside `>` block quotes.

The skill body SHALL document the frontmatter contract the runtime parses:
`title`, `description`, `experiment` (`E<NNNN>-<slug>` or null),
`created_at` / `updated_at` (ISO8601 with timezone offset), `commits[]` (each
`repo`, `sha`, `url`, optional `subject`, and `reviewed`), and
`review_todolist[]` (each `item` and `done`). It SHALL state that completion is
derived (the human checks the boxes in the dashboard) and that the agent writes
every `reviewed` / `done` flag as `false`.

The skill body SHALL give a submodule-aware recipe for the per-commit `url` and
for in-body line-level permalinks: each link uses the owner/repo and `sha` of
the repo the file lives in (the main repo or the specific submodule), with the
`<path>` relative to that repo's root; the commit URL is `…/commit/<sha>` and
the line permalink is `…/blob/<sha>/<path>#L<a>-L<b>`.

The skill body SHALL document the body template: `## Requirement`, `## Changes`,
`## Verification`, `## Notes`, with each change in `## Changes` titled in
Conventional Commits style and carrying the H4 subsections Deliverables, Design
Decisions, Analysis, Verification, and Details (write "None" when empty). It
SHALL instruct: keep inline code minimal and link full code via permalink; go
deep on "why" (underlying root cause + relevant math in `$…$` / `$$…$$`); label
pseudocode with a sentence before the fenced block. It SHALL instruct the agent
to consult the user via AskUserQuestion (or a plain question where that tool is
unavailable) when the change-split granularity is ambiguous, and SHALL frame the
sections as angles to consider rather than a rigid template (omit what does not
apply; extra content is allowed).

The skill SHALL preflight-check the FS convention version per `../PREFLIGHT.md`,
and SHALL appear in `packages/skills/README.md` (the skill-selection matrix and
the files-written table).

On a successful write the skill SHALL push a one-shot notification via the
`memon notify` CLI (the `memon-notify` skill) to tell the user a code-review is
ready: severity `done`, a title beginning with `[code-review]`, passing
`--agent` and `--session`. It is best-effort and runs after the doc is written —
if Telegram is not configured (`memon notify` exits 2) the skill SHALL surface
that once and proceed, never undoing or failing the already-written doc.

#### Scenario: Skill exists with model-invocable frontmatter

- **WHEN** a reader inspects `packages/skills/memon-write-code-review/SKILL.md`
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
  repo's root for both the `/commit/<sha>` and `blob/<sha>/<path>#L<a>-L<b>` forms

#### Scenario: Body template with conventional-commit change titles and five subsections

- **WHEN** a reader inspects the body template
- **THEN** the sections Requirement / Changes / Verification / Notes appear, and
  each change carries the five H4 subsections (Deliverables, Design Decisions,
  Analysis, Verification, Details)

#### Scenario: Listed in the skills index

- **WHEN** a reader inspects `packages/skills/README.md`
- **THEN** `memon-write-code-review` appears in the skill-selection matrix and in
  the files-written table

#### Scenario: Skill body language conventions

- **WHEN** a reader samples headings and paragraphs from the skill body
- **THEN** all sampled prose is in English, and any user-facing dialogue appears
  in Chinese inside `>` block quotes

#### Scenario: Code-review completion notification

- **WHEN** `memon-write-code-review` finishes writing a doc
- **THEN** it issues a `memon notify` with severity `done` and a title beginning
  with `[code-review]`, passing `--agent` and `--session`, and a missing Telegram
  config is surfaced once rather than failing the write

### Requirement: `memon-drive` offers a code-review when a reviewable change lands

The `memon-drive` orchestrator skill SHALL, after a Plan item completes whose
work was a non-trivial code change (a feature, fix, or refactor that landed as
one or more commits) and that has not already been written up, proactively ask
the user whether to capture it as a code-review doc and, on assent, hand off to
`memon-write-code-review` scoped to the current experiment. It SHALL ask once per
reviewable unit (not per commit) and SHALL skip runs / sweeps that produced
results but no code change. `memon-write-code-review` SHALL be listed among
`memon-drive`'s sub-tools.

#### Scenario: Offer fires after a code change, not after a results-only run

- **WHEN** a `memon-drive` Plan item that landed code commits completes
- **THEN** the orchestrator asks the user whether to generate a code-review and,
  on yes, invokes `memon-write-code-review`
- **AND** a Plan item that produced only run results (no code change) gets no offer

#### Scenario: Code-review is a listed sub-tool

- **WHEN** a reader inspects the `memon-drive` skill body
- **THEN** `memon-write-code-review` appears among its sub-tools
