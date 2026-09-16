## MODIFIED Requirements

### Requirement: Component authoring lives in `memon-components`, not in other skills

The harness SHALL bundle a skill `packages/skills/memon-components/SKILL.md` (copied to `.claude/skills/` in the harness repo and shipped by `install-skills`) that is the only skill describing how to write component blocks. It SHALL contain a generated section, delimited by markers, holding one table row per registered component type at its latest version (type, version, one-line description, when to use, payload fields with type/required/meaning, a copyable example) produced by `scripts/component-docs.mjs` from the descriptor directories; the skills build SHALL fail when that section is stale. The skill SHALL teach the declaration syntax, static versus executable payloads, the `script`/`code` reuse rule (inline by default; extract a `.py` only when reused elsewhere or unusually long), the `__assets` cache and `memon components run`, and SHALL NOT tell the agent to query a CLI or HTTP API for field lists. `memon-author-components` SHALL be retired through `retired-skills.json`. `memon-wiki`, `memon-write-experiment-doc`, `memon-run-experiment`, and `memon-write-code-review` SHALL each contain exactly one routing sentence naming `memon-components` and SHALL NOT restate component rules.

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
