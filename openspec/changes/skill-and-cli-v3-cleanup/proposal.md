## Why

`v3-spec-sync` corrected the SSE / spec / web surfaces to match the
v3 file model. Two surfaces still drift from v3:

1. **Skills**: `memon-append-warning`, `memon-run-experiment`, and
   `memon-write-script` still mix v2/v3 talk in the body, mis-route
   content (run-experiment §10 has a "neither side fits" loose path
   for "实现思路 / 让用户注意的细节" that violates the exp/run
   responsibility split), and don't fully integrate the exp doc
   lifecycle into the script-writing flow. Agents reading these
   skills get inconsistent guidance.
2. **CLI**: there's no convenience for the very common skill flow
   "given a run dir, append a warning to its parent exp doc" — the
   agent has to do `memon show <run> | jq .frontMatter.experiment`
   then `memon experiment warning add <exp> --run <run> ...`. Two
   commands per warning is friction, and agents inevitably get the
   resolution step wrong.

This change fixes both: skill rewrites move v2/v3 talk into a single
end-of-document migration helper section and re-route content to its
canonical home; new CLI shortcuts collapse the run-→-exp resolution
into one command.

## What Changes

### Skill rewrites

- **`memon-append-warning`** — rewrite the "Workflow" section to be
  v3-only. All warnings go to the run's parent exp doc via
  `memon experiment warning add <exp-id> --run <run-dir> ...` (or
  the new convenience `memon run warning add <run-dir> ...` from
  this change). The "v3 backend status" caveat block (lines 62-80
  of the current SKILL.md) is **removed** — post-v3-spec-sync it's
  obsolete history. The "v2 form" invocation example is removed.
  No mention of v2 6-col tables; the migration guide guarantees
  no v2 tables exist in a project that's currently on v3, and the
  parser back-compat is invisible at the skill level.

- **`memon-run-experiment`** — substantial restructure:
  - **Body** (§0 through §11) drops every `v2` / `v3` /
    `FS_CONVENTION_VERSION` reference. The skill assumes v3
    throughout; if the project is at an older convention version,
    the preflight (currently §"Preflight") catches it and points
    the agent at `memon-migrate-fs` (no inline branching).
  - **§10 (terminal — success path)** drops the loose "如果两边都
    没合适的位置写" bullet. The two content kinds get deterministic
    homes: 实现思路 (`how I made it run`, design rationale) →
    parent exp doc's `## Method`; 让用户注意的细节 (caveats /
    warnings / interpretive limits) → parent exp doc's `## Caveats`.
    No third location.
  - **New "Migration helpers" section at the end** consolidates
    the few "what if you walk into an old project" tips: detection
    via `memon fs-version check`, when to invoke `memon-migrate-fs`,
    how to ask the user for migration consent. Moves out of the
    body and into a single end-of-doc reference block.

- **`memon-write-script`** — substantial restructure to integrate
  the exp doc lifecycle:
  - **New §1 "Identify the parent experiment"** — three branches:
    1. The user named an exp (id or slug). Verify the exp doc
       exists; READ its `## Method`; the new script will be
       registered there.
    2. The user described an experiment but didn't reference an
       existing exp. Ask if they want a new exp doc; if yes,
       discuss initial Motivation / Method / Conclusion stub
       content with the user, then call `memon experiment create`.
    3. The user explicitly says "just write the script" with no
       exp context. Skip the exp doc entirely; the script gets
       no exp-binding comment.
  - **New step at "When you're done"**: if bound to an exp,
    register the script's relative path + one-sentence purpose
    in the exp doc's `## Method` section (so future agents looking
    at the exp can find every script that contributes to it). Use
    the new CLI from this change.

### CLI additions

- **`memon run warning add <run-dir-or-id> --category <c> --message <m>
  [--note <n>] [--expected-mtime <ms>] [--expected-hash <sha1>]`** —
  convenience that resolves the run's parent exp doc id and
  dispatches to `memon experiment warning add <exp> --run <run> ...`.
  Refuses with `BAD_STATE` (exit 9) when the run is orphan
  (`frontMatter.experiment` is null/empty), prompting the user to
  bind it via `memon experiment link` first. Same exit codes /
  output shape as the underlying `experiment warning add`.

- **`memon run resolve-exp <run-dir-or-id>`** — prints the parent
  exp doc id to stdout (one line, no JSON). Exits 0 when bound; 4
  (`NOT_FOUND`) when the run dir doesn't exist; 9 (`ORPHAN_RUN`)
  when the run is unbound. Lets shell scripts do `EXP=$(memon run
  resolve-exp $RUN)` cleanly.

- **No** `memon experiment script add` — per the user's design
  decision, scripts live in the exp doc's `## Method` body, not in
  a structured registry. Skill `memon-write-script` writes them
  there directly via the existing `memon experiment readme write`
  (or via the editor in the dashboard).

## Capabilities

### New Capabilities

- _(none)_ — every behavior change extends an existing capability.

### Modified Capabilities

- `memon-skills` — three skill rewrites (`memon-append-warning`,
  `memon-run-experiment`, `memon-write-script`); skill content is
  governed by this capability since it ships in the bundled
  `packages/skills/`.
- `memon-cli` — two new run-side subcommands (`memon run warning
  add`, `memon run resolve-exp`).

## Impact

- **`packages/skills/memon-append-warning/SKILL.md`** — rewrite,
  ~80 lines of body + drop the 19-line "v3 backend status" block.
- **`packages/skills/memon-run-experiment/SKILL.md`** — restructure
  + drop ~15 inline v2/v3 mentions, add ~30-line "Migration
  helpers" closing section, rewrite §10's content-routing bullet.
- **`packages/skills/memon-write-script/SKILL.md`** — add new §1
  identification branch, add closing-step registry write. Drop the
  current "exp-doc handling is `memon-run-experiment`'s job"
  disclaimer (now partial responsibility).
- **`packages/cli/src/index.ts`** — wire two new subcommands
  under the existing `run` subcommand group.
- **`packages/cli/src/commands/run-warning.ts`** (new) — implements
  `runWarningAdd` (resolve + dispatch).
- **`packages/cli/src/commands/run-resolve-exp.ts`** (new) —
  implements `runResolveExp` (read index entry, return
  `frontMatter.experiment`).
- Tests: CLI unit tests for both new commands (orphan refuse path,
  bound dispatch path).
- No web app changes. No spec changes outside `memon-skills` /
  `memon-cli`. No on-disk schema change. No migration needed.
