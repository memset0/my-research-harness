## Why

The current invocation policy splits the 8 bundled skills into "user-invoked only" (6 carry `disable-model-invocation: true`) and "model-invocable" (2 — `memon-append-journal` and `memon-append-warning` — defaults). The original rationale was "heavy work needs a human in the loop". That bar has shifted: with the upcoming `memon-drive` skill (a conversational orchestrator that calls `memon-write-script` and `memon-run-experiment` as sub-tools), the per-skill confirmation gate becomes friction. The user has decided five of the six should now be model-invocable, with `memon-migrate-fs` remaining user-only because it makes irreversible-without-git-revert filesystem mutations.

## What Changes

- Remove the `disable-model-invocation: true` frontmatter line from these five SKILL.md files:
  - `memon-write-script`
  - `memon-run-experiment`
  - `memon-digest-journal`
  - `memon-write-report`
  - `memon-propose`
- **Keep** `disable-model-invocation: true` on `memon-migrate-fs/SKILL.md`. Migration cascades commits / writes `.memon/version.json` / applies per-step on-disk schema changes. The skill's body already mandates an explicit user `y` before any write, but the frontmatter flag is belt-and-suspenders — the user wants the agent to be unable to auto-fire it at all.
- Update `packages/skills/README.md`'s "Invocation policy" section to reflect the new state: 7 skills model-invocable, 1 user-only (`memon-migrate-fs`). The README's "Pick the right skill for the job" matrix's "Notes" column for the 5 affected skills SHOULD lose the "User-invoked." prefix since it no longer differentiates them.

Out of scope:
- Adding the new `memon-drive` skill (separate change `skills-add-drive`).
- Plan-section routing changes (already shipped: `skills-plan-section-routing`).
- Tweaking what each skill DOES — only the invocation gate flips.

Acceptance gate:
- `grep -lE '^disable-model-invocation: true$' packages/skills/memon-*/SKILL.md` returns exactly one path: `memon-migrate-fs/SKILL.md`.
- The README's "Invocation policy" section names the new split (7 model-invocable / 1 user-only) and `memon-migrate-fs` is named as the lone exception.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `memon-skills`: MODIFY the "Invocation policy" requirement (in `openspec/specs/memon-skills/spec.md`) so 7 of the 8 skills default to model-invocable, with `memon-migrate-fs` retaining its user-only gate.

## Impact

- **Code**: none.
- **Docs / skill bodies**: 5 SKILL.md frontmatter edits (one line removed each); `packages/skills/README.md` (Invocation policy paragraph + matrix Notes column update).
- **Specs**: delta on `memon-skills` (modify the invocation policy requirement).
- **No runtime changes**.
- **Migration risk**: the agent now CAN fire heavy skills autonomously. Each skill's body still has its own confirmation / safety logic (e.g. `memon-run-experiment` §0 asks the user to confirm the parent experiment; `memon-write-script` walks Branch 1/2/3 with user input). If those internal checks are sufficient, the change is safe. If an agent skips them, it's a per-skill issue, not a policy issue.
