## ADDED Requirements

### Requirement: `memon-run-experiment` SHALL explicitly forbid non-regex-conforming failed-run dir names

The `## Anti-patterns` section of `packages/skills/memon-run-experiment/SKILL.md` SHALL contain a bullet stating that a failed run's dir basename which does NOT match `^.+-\d{6}-\d{6}$` causes memon discovery to silently skip the dir, dropping the failure record from the user's view.

The bullet SHALL be phrased to make the cause-and-effect explicit (non-conforming name → discovery skip → user loses visibility) so the agent reading the skill cold understands why the regex matters even on a failure path (which is when shortcuts are most tempting).

#### Scenario: Run-experiment anti-pattern names the regex
- **WHEN** a reader inspects the `## Anti-patterns` section of `packages/skills/memon-run-experiment/SKILL.md`
- **THEN** at least one bullet contains the literal regex pattern `^.+-\d{6}-\d{6}$`
- **AND** that bullet's text explains the consequence (memon discovery silently skips the dir, the failure record gets dropped or becomes invisible)
