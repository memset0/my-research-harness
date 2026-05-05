## Why

memon stores its source of truth on disk (README.md / HYPOTHESES.md / JOURNAL.md / docs/digests/ / docs/reports/) under user-owned project roots. As the tool's filesystem conventions evolve, breaking changes (renamed files, new required frontmatter fields, restructured directories) leave previously-installed project roots in a state the new tool can no longer correctly read or write — silently, in many cases.

Today there is no version marker per project root and no way for an agent to discover that a project's on-disk layout is out of date. The user has signalled they want any future schema change to be **agent-applied via natural-language migration guides**, not through hardcoded migration scripts that bake fragile assumptions into release binaries. This change builds the skeleton for that workflow before the first breaking change ships, so the framework is in place when it's actually needed.

## What Changes

- Introduce a single integer **FS convention version** (`FS_CONVENTION_VERSION`) sourced from `packages/core`, **independent from package semver**. Bumped only on breaking on-disk schema changes; non-breaking additions do not bump it.
- Stamp every project root with a versioned marker file at `<projectRoot>/.memon/version.json` (containing the version, install timestamp, and last-migrated timestamp) at `memon install-skills` time. First-time install writes the **current** version (no migration triggered); reinstall on a project with an older version surfaces the upgrade availability.
- Establish a directory `packages/core/migrations/` for natural-language migration guides (`v<N>-to-v<N+1>.md`). **No guides are written in this change** — the directory only carries a `README.md` explaining the contract.
- Add a shared **preflight version check** that all memon skills (and the CLI itself) consult before doing read/write work on the project root. On version mismatch the agent surfaces the gap to the user, asks for confirmation, then runs the migrations sequentially.
- Define the **migration runtime protocol**: working-tree-clean precondition → for each step `v<N>→v<N+1>`, read the guide, apply edits, bump `.memon/version.json`, `git commit` with a fixed-format message → repeat to target version. Non-git project roots get a backup tarball per step instead of a commit.
- Define a **meta-spec for guide authoring** so future humans / agents writing a real migration guide have a fixed structure to follow (background, detection conditions, file-level changes, verification, rollback, edge cases).
- Update repo `CLAUDE.md` with a project rule: when a future breaking change requires writing a migration guide, the agent SHALL first consult `openspec/specs/fs-migration-guide-authoring/` rather than improvising structure.

**Not in scope (deliberately deferred):**
- Authoring any concrete `vN-to-vN+1.md` migration guide. The first will land alongside the first real breaking change.
- Dry-run / diff preview before user confirmation (a follow-up iteration).
- Mid-migration crash recovery (resume from intermediate step). First version assumes single uninterrupted run.

## Capabilities

### New Capabilities
- `fs-version-tracking`: source of the `FS_CONVENTION_VERSION` constant, schema and lifecycle of `.memon/version.json`, the read/write API for that marker.
- `fs-migration-runtime`: detection points (CLI install + skill preflight), user-confirmation flow, sequential per-step migration with git commits, dirty-tree refusal, non-git backup-tarball degradation, and the agent skill that orchestrates it.
- `fs-migration-guide-authoring`: meta-spec describing how a future migration guide MUST be structured (sections, detection conditions, verification steps, commit-message format, edge-case handling) — referenced by future authors but introduces no guide of its own.

### Modified Capabilities
- `memon-cli`: `memon install-skills` SHALL additionally write/update `<projectRoot>/.memon/version.json` and report mismatch when an existing marker is older than the current `FS_CONVENTION_VERSION`. The JSON output gains a `fsVersion` block describing what the run found and what it wrote.
- `memon-skills`: every skill that reads or writes a spec file (`memon-run-experiment`, `memon-digest-journal`, `memon-write-report`, `memon-write-script`, `memon-propose`, `memon-append-journal`) SHALL preflight-check `.memon/version.json` against the bundled `FS_CONVENTION_VERSION` and refuse to proceed on mismatch unless the user has explicitly opted to run despite-mismatch.

## Impact

- **Code**:
  - `packages/core/src/version.ts` (new): exports `FS_CONVENTION_VERSION`.
  - `packages/core/src/fs-version/` (new): `read.ts`, `write.ts`, schema, types for `.memon/version.json`.
  - `packages/core/migrations/README.md` (new): explains directory contract; no guide files yet.
  - `packages/cli/src/commands/install-skills.ts`: also writes/updates the version marker; emits `fsVersion` in JSON output.
  - `packages/skills/memon-*/SKILL.md`: each gains a "preflight version check" step at the top (uses a shared snippet pattern, not duplicated logic).
  - New skill `packages/skills/memon-migrate-fs/SKILL.md`: orchestrates the migration. Runs the per-step protocol, stamps the marker, commits.
- **CLAUDE.md**: add the rule pointing future guide authors at the meta-spec.
- **Output schema**: `memon install-skills --format json` gains a `fsVersion` field. Downstream consumers (currently none in-tree) need to tolerate the addition.
- **No DB / network surface changes.** All state lives in `<projectRoot>/.memon/version.json` plus the in-process constant.
- **Cross-cuts with `multi-agent-skills-install` (in-flight)**: that change makes install write to multiple agent skills dirs (`.claude/`, `.codex/`, `.opencode/`). The version marker is **per-project, not per-agent** — a single `.memon/version.json` regardless of how many agent skill dirs the install populated. This change SHOULD land after `multi-agent-skills-install` so the install-skills code surface is stable; if both are mid-flight, expect a small merge in `install-skills.ts`.
