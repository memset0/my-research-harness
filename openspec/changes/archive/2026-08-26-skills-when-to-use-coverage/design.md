## Context

The 3 skills with existing `When to use` / `When NOT to use` sections (`memon-append-journal`, `memon-append-warning`, `memon-migrate-fs`) each follow the same structural pattern:

- `## When to use` — 4–6 bullets, each one a positive declarative scenario ("You observed something cross-cutting...", "The user asks you to...").
- `## When NOT to use` — 4–6 bullets, each prefixed `❌`, naming the alternative skill or surface where the work should land instead.

This change replicates that pattern for the 5 skills that don't yet have it. Position: immediately after the now-condensed preflight pointer (5 lines), before the next existing top-level heading. That gives a reader the imperative ("run the preflight") plus the routing decision ("does this skill apply at all?") in the first ~15 lines of every SKILL body.

## Goals / Non-Goals

**Goals:**
- 5 SKILL.md files gain `## When to use` and `## When NOT to use` sections in a consistent format, immediately after the preflight pointer.
- Each section has 4–6 bullets. Bullets in `When to use` are positive scenarios; bullets in `When NOT to use` are `❌`-prefixed and name the alternative.
- README's matrix is updated to 8 rows.

**Non-Goals:**
- Re-wording the existing 3 skills' When-to-use sections.
- Modifying the body of any other section in any skill.
- Trimming frontmatter `description` fields.
- Adding a CI check that scans for these sections (manual `grep` + spec scenario is enough for now).

## Decisions

### Decision 1: Bullet wording for each of the 5 skills

For each skill, the bullets are crafted to be specific (name the trigger or alternative, not generic), short (one sentence each), and complementary (When to use / When NOT to use bullets together cover the routing decision).

The full text per skill is fixed in tasks.md (Decision: keep authorial control of the bullet wording in tasks.md so apply-time edits are traceable to a single source).

### Decision 2: Section position

Sections go between the preflight pointer (which ends 5 lines after the `## Preflight — FS convention version` heading) and the next existing top-level heading. Concretely, in each of the 5 files:

- `memon-write-script` — between Preflight and `## Identify the parent experiment`.
- `memon-run-experiment` — between Preflight and `## Prerequisite — read CLAUDE.md first`.
- `memon-digest-journal` — between Preflight and `## File naming`.
- `memon-write-report` — between Preflight and `## File naming`.
- `memon-propose` — between Preflight and `## Why brainstorm at all`.

### Decision 3: README matrix expansion

The new row added to `packages/skills/README.md`'s "Pick the right skill for the job" table:

```
| Migrate a project's on-disk layout to a newer FS convention version | `memon-migrate-fs` | User-invoked. Only skill that bumps `.memon/version.json`. Exempt from the FS-version preflight. |
```

Position: at the bottom of the existing 7-row table, after `memon-propose`. Order in the matrix follows the README's existing top-down narrative (heavier-write skills earlier, read-only later, exception last).

## Risks / Trade-offs

- **Risk**: Adding 4–6 bullets × 2 sections × 5 skills means ~50 lines of new content. Skills that were already long get a bit longer. → **Mitigation**: the value (faster routing decisions) outweighs the line cost. The bullets are short.
- **Risk**: Bullet wording may need iteration after first reading. → **Mitigation**: the first apply lands a defensible draft; the user can request specific bullet edits in a follow-up turn before commit.
- **Trade-off**: The 3 existing skills' bullets are preserved as-is, even where the new 5 might use slightly different phrasing. Acceptable — a future polish pass can normalise wording across all 8 if drift bothers anyone.

## Migration Plan

Pure content additions. No on-disk migration. After apply:

```sh
grep -l '^## When to use$' packages/skills/memon-*/SKILL.md | wc -l
# Expected: 8 (all 8 skills now have the section).

grep -c '^| ' packages/skills/README.md | grep -E '^[0-9]+$' | head -1
# Eyeball: matrix should have 8 data rows + 1 header + 1 separator row.
```
