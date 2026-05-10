## Why

Three of the eight bundled skills (`memon-append-journal`, `memon-append-warning`, `memon-migrate-fs`) open with `## When to use` / `## When NOT to use` sections — concise 4–6 bullet decision-aids that tell an agent (or a human reading the skill cold) whether the skill applies to their current goal. The other five (`memon-write-script`, `memon-run-experiment`, `memon-digest-journal`, `memon-write-report`, `memon-propose`) lack those sections; their applicability is buried in prose deeper in the doc, which makes "should I invoke this skill?" decisions slower for both humans and agents and costs more tokens for an agent to load enough context to make the call.

The README's `## Pick the right skill for the job` table is currently 7 rows but `SKILL_NAMES` has 8 entries — `memon-migrate-fs` is missing from the matrix even though it's a legitimate user-invokable skill. A reader skimming the README sees an under-counted skill set.

## What Changes

- Add `## When to use` and `## When NOT to use` sections to the 5 skills currently missing them. Each section is 4–6 bullets:
  - `memon-write-script`
  - `memon-run-experiment`
  - `memon-digest-journal`
  - `memon-write-report`
  - `memon-propose`
- The new sections are inserted right after the `## Preflight — FS convention version` pointer (which is now a 5-line section thanks to A2), before the next existing top-level heading in each skill.
- Add a row for `memon-migrate-fs` to `packages/skills/README.md`'s `## Pick the right skill for the job` table. The new row joins the existing 7 in the same `(action) | (skill) | (notes)` format.
- The existing 3 skills' `When to use` sections are NOT modified — they already match the convention.

Out of scope:
- Trimming the frontmatter `description` field of any skill (a separate concern).
- Standardising `## Anti-patterns` / `## Constraints` / `## Heuristics` section names (covered by the next change, `skills-section-naming-unify`).
- Standardising inline Chinese dialogue placement (covered by a separate later change).
- Touching `memon-migrate-fs/SKILL.md`'s body — its existing `## When to use` / `## When NOT to use` sections are already fine.

Acceptance gate (user-verifiable after apply):
- All 8 skills have `## When to use` and `## When NOT to use` sections (`grep -l '^## When to use$' packages/skills/memon-*/SKILL.md` returns 8 paths).
- Each new section has 4–6 bullets.
- README's matrix has 8 rows for 8 skills.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `memon-skills`: ADD a new requirement that every bundled skill body SHALL contain `## When to use` and `## When NOT to use` sections (4–6 bullets each), positioned near the top of the body so a reader sees them before the workflow detail. The README matrix SHALL list every skill in `SKILL_NAMES`.

## Impact

- **Code**: none.
- **Docs / skill bodies**: 5 SKILL.md files gain new sections (`memon-write-script`, `memon-run-experiment`, `memon-digest-journal`, `memon-write-report`, `memon-propose`); `packages/skills/README.md` gains one matrix row.
- **Specs**: delta on `memon-skills` (ADD a new requirement on When-to-use coverage + matrix completeness).
- **No runtime changes**: SKILL.md content edits only; no install-skills.ts or test changes.
- **Migration risk**: low. The new sections are additive — agents that ignore them still see the rest of the skill body as before. Agents that DO read them get faster routing.
