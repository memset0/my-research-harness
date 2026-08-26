## ADDED Requirements

### Requirement: `memon-drive` is the ninth bundled skill — conversational orchestrator

A bundled skill `packages/skills/memon-drive/SKILL.md` SHALL exist alongside the existing eight skills. Its frontmatter SHALL NOT carry `disable-model-invocation: true` (it is model-invocable per the policy in this spec's "Skill invocation policy split by risk tier" requirement). Its body SHALL conform to the project-wide skill conventions (English body; embedded Chinese for user-facing dialogue with the `(in Chinese):` blockquote convention; `--project-root` discipline; `## Preflight — FS convention version` pointer to `../PREFLIGHT.md`).

`memon-drive` is the **conversational orchestrator** for one experiment's lifecycle. Its core responsibility is to maintain the parent experiment doc as a living artifact: in particular, the exp doc's `## Plan` section is the agent's primary canvas during the session. It MAY invoke `memon-write-script` and `memon-run-experiment` as sub-tools (both now model-invocable per `skills-allow-model-invocation`). It SHALL distinguish launcher scripts (use `memon-write-script`) from inline analysis utilities (write inline, no run dir, no Method registration).

#### Scenario: Skill exists with correct frontmatter
- **WHEN** a reader inspects `packages/skills/memon-drive/SKILL.md`
- **THEN** the frontmatter has `name: memon-drive`
- **AND** the frontmatter does NOT contain `disable-model-invocation: true`
- **AND** every `memon ...` example in the body passes `--project-root .` (or `--project-root <p>`) explicitly

#### Scenario: Skill body has the required structural sections
- **WHEN** a reader inspects `packages/skills/memon-drive/SKILL.md`
- **THEN** the body contains exactly one `## Preflight — FS convention version` section (≤5 prose lines, references `../PREFLIGHT.md`)
- **AND** the body contains exactly one `## When to use` section (3–6 bullets)
- **AND** the body contains exactly one `## When NOT to use` section (3–6 `❌`-prefixed bullets)
- **AND** the body describes two entry modes — starting fresh AND resuming an existing experiment
- **AND** the body contains a `## Workflow` section with at least 5 numbered steps
- **AND** the body contains an `## Anti-patterns` section

#### Scenario: Skill body covers Plan as primary canvas
- **WHEN** a reader inspects the workflow section of `memon-drive/SKILL.md`
- **THEN** the body explicitly names `## Plan` as the agent's primary canvas during the session
- **AND** the body describes flipping `[ ]` → `[x]` on completing a Plan task
- **AND** the body describes adding per-run learnings as reflection sub-bullets under the relevant Plan task

#### Scenario: Skill body distinguishes launcher vs. analysis utility
- **WHEN** a reader inspects `memon-drive/SKILL.md`
- **THEN** the body contains a dedicated section or paragraph distinguishing launcher scripts (use `memon-write-script`) from inline analysis utilities (write inline, no run dir)
- **AND** the distinguishing criterion is observable in the text: launchers create run dirs / emit `[memon] ...` echo lines / typically need GPU / typically take minutes-to-days; analysis utilities are reproducible-from-input-in-seconds-to-minutes / no GPU / no run dir
- **AND** the body explicitly states that inline analysis utilities do NOT get registered in the exp doc's `## Method` (they're tooling, not methodology)

#### Scenario: Skill body covers conversation-to-doc transcription
- **WHEN** a reader inspects the workflow section of `memon-drive/SKILL.md`
- **THEN** the body instructs the agent to continuously transcribe important conversation content into the appropriate exp doc section as the conversation evolves (not only after a Plan task completes)
- **AND** the body includes guidance for the "unsure whether to record" case: ask the user (in Chinese), don't drop on the floor

#### Scenario: Skill body surfaces FINISHED-readiness as a signal
- **WHEN** a reader inspects the final workflow step of `memon-drive/SKILL.md`
- **THEN** the body names the three-signal check (all `[x]` in Plan / every member run terminal / `## Conclusion` non-empty)
- **AND** the body explicitly frames the readiness as a *signal* the agent surfaces for user confirmation, NOT an automatic state transition

#### Scenario: `SKILL_NAMES` registry includes `memon-drive`
- **WHEN** a reader inspects `packages/skills/src/index.ts`
- **THEN** the `SKILL_NAMES` tuple contains the literal string `'memon-drive'`
- **AND** the tuple length is 9

#### Scenario: README matrix lists `memon-drive`
- **WHEN** a reader inspects `packages/skills/README.md`'s "Pick the right skill for the job" matrix
- **THEN** there is a row whose "Use" column contains the literal string `memon-drive`
- **AND** the matrix has 9 data rows total
