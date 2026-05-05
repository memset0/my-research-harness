## Context

memon is a files-as-source-of-truth tool. README.md / HYPOTHESES.md / JOURNAL.md / docs/digests/ / docs/reports/ on the user's filesystem **are** the database. There is no migration story yet; if a future memon release renames a file, restructures frontmatter, or reorganises a directory, every previously-installed project root silently desynchronises from the tool.

The user has already decided two foundational things:

1. **No hardcoded migration scripts in the release binary.** Instead, breaking changes are described as natural-language migration guides under `packages/core/migrations/v<N>-to-v<N+1>.md`. An LLM agent reads them and applies the changes. This trades determinism for resilience — guides can be authored after release, can handle situations the original author didn't anticipate, and don't carry forward accumulated migration cruft in the binary.
2. **The FS-convention version is independent from package semver.** Package version moves on every patch / refactor / dependency bump; FS-convention version moves only on user-observable on-disk schema changes. Coupling them would cause cry-wolf upgrade prompts on every patch release.

This design lays the rails. The first concrete migration guide is deliberately deferred until a real breaking change ships — the goal here is the framework, not the first traveller on it.

The change touches five existing surfaces:

- `packages/core` — gets a new module exporting the version constant and the `.memon/version.json` reader/writer.
- `packages/cli` — `memon install-skills` is extended to stamp the marker.
- `packages/skills/memon-*` — every skill that does spec-file I/O gains a preflight check.
- A new skill `packages/skills/memon-migrate-fs` — orchestrates a confirmed migration end-to-end.
- `openspec/specs/fs-migration-guide-authoring/` — meta-spec read by future authors.

It also lightly intersects with the in-flight `multi-agent-skills-install` change: the marker is per-project, not per-agent, so install logic writes one `.memon/version.json` regardless of how many agent skill dirs are populated.

## Goals / Non-Goals

**Goals:**
- A single integer version stamped into each project root, written at install time.
- A detection mechanism (CLI install + agent skill preflight) that catches mismatches early — before destructive writes — and surfaces them to the user.
- A migration protocol that an LLM agent can execute step-by-step from natural-language guides, with safety rails (clean working tree, per-step git commits, non-git fallback to backup tarballs).
- A meta-spec defining how future migration guides MUST be structured, so guide authors don't reinvent the layout each time.
- Update path documented in repo `CLAUDE.md` so future agents authoring guides know to consult the meta-spec first.

**Non-Goals:**
- Authoring any concrete `vN-to-vN+1.md` guide. The first one ships with the first real breaking change.
- A dry-run / diff-preview mechanism before user confirmation. (Explicit follow-up.)
- Mid-migration crash recovery (resume from intermediate step). First version assumes a single uninterrupted run; the per-step `git commit` boundary is the recovery surface.
- Forward-compat (newer project root than the installed tool). The check refuses cleanly with an error directing the user to upgrade memon; we do not attempt to "downgrade" the project root.
- Version-skew warnings on every CLI command. Only `install-skills` and skills that read/write spec files preflight-check; pure read-only CLI commands like `memon show` SHOULD NOT preflight.

## Decisions

### D1. Version is an integer constant in code, not a config file

`packages/core/src/version.ts` exports `export const FS_CONVENTION_VERSION = 1 as const`. It is a code constant, not a value loaded from `package.json` or a YAML config.

**Why:**
- Bundling it as code means the value is locked to the release artifact — there is no runtime drift between "what version of memon you ran" and "what convention version it understood".
- Keeping it separate from `packages/core/package.json#version` lets us bump the package for non-breaking work (refactors, deps, performance) without confusing users about migration.
- Integer-only (not semver) because there is exactly one dimension of evolution that matters: breaking schema changes. Patch / minor distinctions add no information.

**Alternatives considered:**
- *Read version from `packages/core/package.json#fsConventionVersion`*: tempting for one place to edit on bumps, but causes surprising re-reads at runtime and risks divergence between source-of-truth and what the bundled JS actually closes over. Rejected.
- *Use semver (e.g., 1.0.0)*: provides illusion of granularity. Since only major bumps would actually trigger migration, the minor/patch fields would be confusing dead weight. Rejected.

### D2. Per-project marker at `<projectRoot>/.memon/version.json`

```json
{
  "fs_convention_version": 1,
  "installed_at": "2026-05-04T10:00:00+08:00",
  "last_migrated_at": null
}
```

**Why this location:**
- `.memon/` is a fresh hidden directory under the project root, parallel to `.claude/skills/`. Clearly memon-owned, doesn't squat on existing user paths.
- JSON (not YAML) because the rest of memon writes/reads JSON for machine-state (`memon show <id> --format json`), while spec files (README/HYPOTHESES/JOURNAL) are markdown for humans. This file is machine state, follow the JSON convention.
- Single-purpose file. We do NOT make `.memon/` a kitchen-sink directory now; if other persistent metadata appears later, it gets a sibling file (`.memon/last-doctor-run.json` etc.).

**Why these fields:**
- `fs_convention_version` (integer): the truth.
- `installed_at` (ISO8601 with offset, per repo convention): forensic — when was memon first attached to this project root? Useful when a user reports a bug and we want to know "old install or fresh".
- `last_migrated_at` (ISO8601 with offset, nullable): when was the most recent successful migration? `null` means no migration has run since first install. Helps debug "I ran migrate, then it stopped working" stories.

**Alternatives considered:**
- *Single field `version` at `.memon/version`*: simpler but loses the diagnostic timestamps that are practically free to write.
- *Embed in existing `.claude/settings.local.json` or similar*: cross-cuts concerns; deletes the .claude dir would lose memon state. Rejected.

### D3. Install is the single write site; preflight is read-only

`memon install-skills` is the **only** path that creates or rewrites `.memon/version.json`. Specifically:
- If the file does not exist: write it with `fs_convention_version = FS_CONVENTION_VERSION` and `installed_at = <now>`. **Do not** trigger migration prompting — first install means no legacy state to migrate.
- If the file exists with `version === FS_CONVENTION_VERSION`: leave the file untouched.
- If the file exists with `version < FS_CONVENTION_VERSION`: leave the file untouched, surface the upgrade availability in the install-skills output (CLI prints a banner, JSON includes `fsVersion: { current: N, available: M, upgradeRequired: true }`), and instruct the user to invoke the migration skill. Install does NOT migrate; it only reports.
- If the file exists with `version > FS_CONVENTION_VERSION`: this means a newer memon installed it once and now the user is running an older memon. Refuse with `MEMON_TOO_OLD` exit code; tell the user to upgrade memon.

**Migration is the only other write site.** The `memon-migrate-fs` skill bumps `fs_convention_version` and `last_migrated_at` after each successful step.

**Why centralised writes:**
- Two write sites = clear audit. Anything else updating this file is a bug.
- Skill preflight is read-only by design: a skill discovers mismatch, surfaces it, and stops. It does not "auto-migrate" — that requires explicit user consent and the dedicated skill.

### D4. Preflight check is a shared snippet, not duplicated logic

Every skill that reads/writes spec files (`memon-run-experiment`, `memon-digest-journal`, `memon-write-report`, `memon-write-script`, `memon-propose`, `memon-append-journal`) needs to preflight. We do NOT want six divergent copies of the same check growing apart over time.

Approach:
- A shared CLI subcommand `memon fs-version check --project-root <p>` performs the check and emits JSON: `{ projectVersion, toolVersion, status: "match" | "behind" | "ahead" | "uninitialised" }`.
- Each skill's SKILL.md adds a fixed two-line preamble that calls this command and branches on the status.
- Skills reference the same canonical preamble text. When the protocol changes, we update one place (the meta-spec) and re-stamp.

**Why a CLI subcommand and not a Node import:**
- Skills are LLM-targeted markdown that runs shell. Adding a Node import would require building/installing a JS helper. A `memon` subcommand is uniform with the rest of skill workflow.
- The check is part of the skill body's user-visible workflow; making it a shell call keeps the contract observable.

**Alternatives considered:**
- *In-skill preflight via `jq` reading `.memon/version.json` directly*: would work, but every skill would duplicate the comparison logic, and the schema would leak. Rejected.

### D5. User confirmation is mandatory; agents never auto-migrate

When mismatch is detected (either by `install-skills` or by skill preflight), the agent:
1. States the gap clearly: "Project root is at FS convention v<X>; tool expects v<Y>. Migrating will run <N> step(s): v<X>→v<X+1>, ..., v<Y-1>→v<Y>."
2. Asks the user explicitly whether to proceed. (`AskUserQuestion` for Claude Code; equivalent for other agents.)
3. Only on affirmative response does the migration run.

No silent migration, ever. The user message that triggered the agent could be anything; treating "I want to add a journal entry" as implicit consent to rewrite the project's on-disk schema would be catastrophic.

### D6. Migration runtime: per-step git commit boundaries

Once the user confirms, the `memon-migrate-fs` skill executes:

```
preflight:
  abort if working tree is dirty (untracked counts; surface, ask user to commit/stash first)
  if project root is not a git repo:
    skip git checks; switch to backup-tarball mode (D7)

for each step from current_version to target_version:
  read packages/core/migrations/v<current>-to-v<current+1>.md
  if it doesn't exist: abort with clear error
  apply the changes described
  bump .memon/version.json (version += 1, last_migrated_at = now)
  if git mode:
    git add -- <files this step touched>  # NOT git add -A
    git commit -m "chore(memon): migrate FS convention v<current> -> v<current+1>"
  else:
    write .memon/backups/post-v<current+1>-<timestamp>.tar.gz with the touched files
  current_version += 1
```

**Why per-step commits instead of one big commit:**
- Each step is a distinct semantic unit. Commits at step boundaries let the user `git reset --hard HEAD~1` if they distrust step N's result, without losing the work from steps 1..N-1.
- The diff for each commit is a self-contained migration delta, much easier to review than a multi-version mega-diff.
- Commit messages provide an audit trail visible from `git log`.

**Why scoped `git add` (not `git add -A`):**
- Repo `CLAUDE.md` already establishes this rule: parallel agent sessions may have unrelated dirty files; sweeping them in contaminates the migration commit. The migrate-fs skill MUST stage only files touched by the current step.

**Why dirty-tree refusal up front:**
- If the user has uncommitted work, a per-step commit would tangle their work into the migration commit. Better to refuse cleanly and tell them to commit/stash first than to make a confusing commit that mixes concerns.

### D7. Non-git project roots get a backup tarball per step

Some users will run memon against directories that aren't git repos (one-off experiment scratch dirs, NFS shares without local git, etc.). For these:
- `git status` returns non-zero (or "not a git repository" message); migrate-fs detects this and switches to tarball mode.
- Before each step's edits, write `.memon/backups/pre-v<N+1>-<ISO8601-timestamp>.tar.gz` covering only the files the step is about to touch (read from the guide's "files-changed" section, or, conservatively, the entire project root if the guide doesn't constrain).
- Do NOT commit. The tarball is the rollback artifact.

This is a degraded experience compared to git mode (no atomic per-step rollback, harder to inspect what changed), but it's better than no safety net.

### D8. Migration guides are markdown with a fixed structure

Each `packages/core/migrations/v<N>-to-v<N+1>.md` SHALL follow a fixed template (specified in `fs-migration-guide-authoring`). High-level shape:

```markdown
# Migration v<N> → v<N+1>

## Background / Why
<1–3 paragraphs on what changed in the tool that necessitates this>

## Detection
<how an agent can verify the project root is currently in v<N> state — file presence, frontmatter shape, etc.>

## Diff (v<N> → v<N+1>)
<file-by-file changes, with before/after fragments>

## Target State (v<N+1> Summary)
<canonical structure after migration — used by the agent to verify terminal state>

## Verification
<concrete shell + grep commands the agent runs to confirm migration succeeded>

## Rollback Notes
<what the agent should tell the user if it cannot complete the migration>

## Edge Cases
<known awkward cases and how to handle them>
```

The guide MUST be self-contained — agents read it cold and act on it. No "see also" links to docs that might not be present at runtime.

**Why a fixed structure:**
- LLM agents are most reliable when given consistent shapes. A migration guide written with sections in random order risks the agent missing the verification step.
- Future memon developers writing a guide should not need to reinvent the layout from scratch each time. The meta-spec gives them a template to fill in.

### D9. Forward-compat error path

If `.memon/version.json` reports a version higher than `FS_CONVENTION_VERSION` (project was installed against a newer memon, user is now running an older memon):
- `install-skills` exits with `MEMON_TOO_OLD` (a new entry in the exit-code table).
- Preflight in skills fails with the same code.
- Message: "Project root expects FS convention v<X>; this memon only supports up to v<Y>. Upgrade memon to a release that supports v<X> or later."

We do NOT attempt downgrade migrations. Downgrade guides would be twice the maintenance for a vanishingly rare path; "upgrade your tooling" is the right expectation to set.

### D10. CLAUDE.md update — pointer to the meta-spec

Repo `CLAUDE.md` gains one new short section under "OpenSpec workflow":

> **When authoring a migration guide:** before writing `packages/core/migrations/v<N>-to-v<N+1>.md`, read `openspec/specs/fs-migration-guide-authoring/spec.md`. It defines the required structure, verification standards, and edge-case handling. Do NOT improvise — past iterations of this kind of work in this repo (F2, F3 in the same CLAUDE.md) showed how easily improvised structure leads to silently broken results.

This is a small but load-bearing pointer. Without it, a future agent might write a guide that omits the verification section or uses a freeform structure that doesn't compose with the migrate-fs skill's expectations.

## Risks / Trade-offs

**[R1] User edits `.memon/version.json` by hand and the value disagrees with on-disk reality.**
The migration runtime trusts the recorded version blindly — if the user manually bumped it past where their files are actually at, migrations will be skipped and the project will silently malfunction.
→ Mitigation: document in the version-tracking spec that the file is machine-managed; users should not edit it. Future iteration could add a "fingerprint" (hash of canonical files) to detect manual tampering, but not in this version.

**[R2] Migration guide quality is a single point of failure.**
A poorly-written guide could send the agent down a destructive path (e.g., overly aggressive find-and-replace, missing edge cases). The per-step commit is the only safety net.
→ Mitigation: the meta-spec mandates explicit "Verification" steps that the agent runs after each step. If verification fails, the step is rolled back via `git reset --hard HEAD~1` (git mode) or restored from the tarball (non-git mode). Future iteration can add a pre-flight diff preview.

**[R3] Agent capability drift — guide is interpreted differently across LLM versions / vendors.**
Today the user is using Claude Code; tomorrow they might use Codex or opencode. A guide that works perfectly for one model could confuse another.
→ Mitigation: write guides imperatively (numbered shell-level steps), avoid ambiguous prose, embed verification commands literally. The meta-spec MUST require this style.

**[R4] Non-git fallback offers weaker safety than git mode.**
A backup tarball can be inspected and extracted, but the per-step granular rollback is not as ergonomic as `git reset --hard HEAD~1`. Users in non-git mode get a meaningfully degraded experience.
→ Accepted trade-off; the alternative is refusing to migrate non-git roots, which is too restrictive.

**[R5] Skill preflight adds latency to every spec-file operation.**
Even when versions match, every relevant skill now runs `memon fs-version check` at the top.
→ Acceptable: the check is local (single file read + integer compare) and runs in the tens-of-milliseconds range. If it ever shows up as a bottleneck, we can cache the result for the lifetime of a session.

**[R6] Forward-compat refusal is annoying when the discrepancy is benign.**
A user upgrades memon, installs into a project, then downgrades memon for some other reason — now their project root reports a "too new" version even though the schema is functionally compatible.
→ Accepted; the contract is "the version is the version, and we don't allow downgrade". A user who genuinely needs to roll back can edit `.memon/version.json` manually with the understanding that they're on their own.

**[R7] CLAUDE.md pointer to meta-spec relies on agents actually reading CLAUDE.md.**
If a future agent skips CLAUDE.md and improvises a guide, the framework breaks.
→ Mitigation: Claude Code loads CLAUDE.md by default; other agents (Codex via AGENTS.md symlink) inherit it via the in-flight `multi-agent-skills-install`. We accept that very off-script use ("agent without CLAUDE.md ingestion") may bypass the pointer, but that's a tooling-config issue, not a design flaw.

## Migration Plan

This change is a framework rollout, not a behaviour change for end users. Deployment is a single `memon install-skills` re-run per project root after upgrading memon:

1. Ship the change.
2. Existing project roots have no `.memon/version.json` yet. On the next `memon install-skills`, the file is created with `fs_convention_version = 1, installed_at = <now>, last_migrated_at = null`. No migration is triggered (because there's no prior version to migrate from).
3. Skills now preflight; for any project root with the marker present and version matching, this is a no-op.
4. Future breaking change: bump `FS_CONVENTION_VERSION` to 2, write `packages/core/migrations/v1-to-v2.md`, ship. Users running `install-skills` see the upgrade banner; running migrate-fs upgrades them.

**Rollback for THIS change:** revert the commits introducing the version constant, the marker, the preflight checks, and the migrate-fs skill. Existing `.memon/version.json` files left on disk become orphaned but harmless — nothing reads them once the code is removed.

## Open Questions

- **OQ1.** Should the agent print a one-time "you're on FS convention vN" notice on first install, so the user knows the marker exists? Leaning yes (good for discoverability), but it's an info-level UX call that can be settled in the spec.
- **OQ2.** Where does `memon fs-version check` live in the CLI command tree? Options: top-level `memon fs-version check` (its own command group) or under `memon doctor` as an additional check. Leaning toward its own group because it has a distinct lifecycle (installer + skills both read it; doctor runs less often). Final shape settled in the `memon-cli` modified spec.
- **OQ3.** Does `memon-migrate-fs` need an explicit `--dry-run` mode in v1, or is "the user reads the guide before confirming" enough? Current design says no `--dry-run` (deferred to follow-up). Confirm in spec.
