## Why

Agents driving `memon-run-experiment` have been observed naming run dirs for failed attempts in formats that don't match the project-wide regex `^.+-\d{6}-\d{6}$` (e.g. `failed-baseline` with no timestamp, or `crash-1` as a fallback). `memon` discovery silently skips non-matching dirs, so those failure records become invisible — the user can't see them in the run list and may forget the attempt ever happened. `memon-write-script` already has an Anti-pattern bullet about regex compliance for new run dirs, but `memon-run-experiment` (which owns the failure path) does not, leaving the gap.

## What Changes

- Add one bullet to `packages/skills/memon-run-experiment/SKILL.md`'s `## Anti-patterns` section:

  ```
  - ❌ Naming a failed run's dir something that doesn't match
    `^.+-\d{6}-\d{6}$` — memon discovery silently skips it, the
    failure record gets dropped.
  ```

Out of scope (deliberately):
- Restructuring §3 / §10b / §11 to force regex compliance at write time. The user has indicated the bullet alone is the right intervention for now; behavior enforcement can come later if the bullet doesn't suffice.
- Touching `memon-write-script` (it already has the equivalent bullet).
- Touching any other skill.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `memon-skills`: ADD a requirement that `memon-run-experiment`'s anti-patterns explicitly call out non-conforming failed-run-dir names as a forbidden practice.

## Impact

- **Code**: none.
- **Docs / skill bodies**: 1 SKILL.md (`memon-run-experiment`), +3 lines in the existing Anti-patterns list.
- **Specs**: delta on `memon-skills` (ADD).
- **No runtime changes**.
- **Migration risk**: zero. Pure documentation reinforcement.
