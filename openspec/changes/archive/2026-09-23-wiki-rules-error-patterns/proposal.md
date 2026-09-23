## Why

`Maintenance rules for agents` records requirements the owner states, but two things are missing. Lessons from failures (an incident, a wrong assumption that cost a run, a tooling trap) stay buried in dated history, where later agents repeat them; they should become rules, yet they are the agent's own conclusions and must not enter the owner's rules unapproved. And appending every requirement makes the section grow without bound, so rules overlap, contradict, or get skipped.

## What Changes

- The `memon-wiki` skill gains an error-pattern workflow: the agent proposes a preventive rule with its exact wording, scope, topic and evidence; it is added, dated with the authorization day, only after the owner approves; declined proposals leave nothing behind. When the owner asks, the agent reviews a page's history for such patterns the same way.
- The skill requires a compact section: fold a new requirement into the rule it refines, merge duplicates and overlaps, and generalize several specific rules into one when the general rule still requires everything. Compression never drops or weakens a requirement without the owner's word, and every merge is reported with the replaced items quoted.
- Skills-only change -> MINOR release.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `memon-wiki-skill`: error-pattern proposals need owner authorization; the rules section is kept compact.

## Impact

- `packages/skills/memon-wiki/SKILL.md` only.
