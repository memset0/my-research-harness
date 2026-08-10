## Why

Agents can currently work around a memon CLI crash, malformed response, or rejection of valid input and still finish the user's task without mentioning the CLI problem. That hides actionable product feedback from the user and makes recurring CLI bugs harder to reproduce and fix.

## What Changes

- Add one shared CLI-issue reporting protocol to the installed skills preflight contract.
- Make every bundled `memon-*` skill explicitly follow that protocol.
- Defer a non-blocking CLI issue report until the skill's final task handoff so the report does not interrupt useful work.
- Require a blocked handoff to include the same report when the CLI issue prevents completion.
- Distinguish suspected CLI problems from expected validation failures, missing project state, and documented command rejection.
- Require reports to include the redacted command, observed versus expected behavior, impact/workaround, and reproducibility.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `memon-skills`: all bundled skills consistently surface encountered memon CLI problems to the user at terminal handoff.

## Impact

- `packages/skills/PREFLIGHT.md`: shared reporting protocol distributed by `memon install-skills`.
- All 11 bundled `packages/skills/memon-*/SKILL.md` files: one concise mandatory reference to the protocol.
- No CLI runtime or project FS format changes.
