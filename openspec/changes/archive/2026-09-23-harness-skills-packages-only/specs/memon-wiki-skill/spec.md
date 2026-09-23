## REMOVED Requirements

### Requirement: `memon-wiki` is bundled and installed in the harness repo

**Reason**: The harness repository must not carry copies of bundled skills; the required `.claude/skills/memon-wiki/` copy never existed.
**Migration**: Replaced by "`memon-wiki` is bundled in `packages/skills`"; projects receive the skill through `memon install-skills`.

## ADDED Requirements

### Requirement: `memon-wiki` is bundled in `packages/skills`

A skill SHALL exist at `packages/skills/memon-wiki/SKILL.md` with `name: memon-wiki`, no `disable-model-invocation: true`, a `references/page-kinds.md` describing every canonical kind's purpose, status vocabulary, required frontmatter, recommended sections, and authoring guidance, and a `references/html-bundle.md` carrying the static bundle contract adapted to the wiki asset route. The skill SHALL exist only under `packages/skills/` and reach projects through `memon install-skills`; the harness repository SHALL NOT carry a copy. `memon-write-report` SHALL remain bundled and unchanged. The skill body SHALL be English; user-facing dialogue examples SHALL be Chinese inside block quotes.

#### Scenario: Skill present only in the package
- **WHEN** a reader lists the harness repository
- **THEN** `packages/skills/memon-wiki/SKILL.md` exists and `.claude/skills/memon-wiki/` does not
- **AND** `packages/skills/memon-write-report/` still exists

## MODIFIED Requirements

### Requirement: Component authoring lives in `memon-components`, not in other skills

The harness SHALL bundle a skill `packages/skills/memon-components/SKILL.md` (shipped to projects by `install-skills`; no harness-repo copy) that is the only skill describing how to write component blocks. It SHALL contain a generated section, delimited by markers, holding one table row per registered component type at its latest version (type, version, one-line description, when to use, payload fields with type/required/meaning, a copyable example) produced by `scripts/component-docs.mjs` from the descriptor directories; the skills build SHALL fail when that section is stale. The skill SHALL teach the declaration syntax, static versus executable payloads, the `script`/`code` reuse rule (inline by default; extract a `.py` only when reused elsewhere or unusually long), the `__assets` cache and `memon components run`, and SHALL NOT tell the agent to query a CLI or HTTP API for field lists. `memon-author-components` SHALL be retired through `retired-skills.json`. `memon-wiki`, `memon-write-experiment-doc`, `memon-run-experiment`, and `memon-write-code-review` SHALL each contain exactly one routing sentence naming `memon-components` and SHALL NOT restate component rules.

#### Scenario: Other skills only route
- **WHEN** a reader greps `packages/skills/memon-wiki/SKILL.md` for `memon-components` and for `views:`
- **THEN** the first matches exactly once and the second not at all

#### Scenario: Skill table is generated
- **WHEN** a descriptor's `description` changes and `scripts/component-docs.mjs --check` runs
- **THEN** the check fails until `--write` regenerates the table, which then lists every registered type at its latest version

#### Scenario: No component fits
- **GIVEN** the agent needs an interactive 3-D plot that no registered component renders
- **WHEN** it follows the skill
- **THEN** it writes an `embed@1` block (static HTML or an executable payload returning `data`) and creates a `harness-feedback` page proposing the component
