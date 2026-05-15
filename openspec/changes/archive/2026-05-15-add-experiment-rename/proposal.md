## Why

`memon run rename <id-or-dir> <new-slug>` shipped with the v3
experiment redesign (`packages/cli/src/commands/run-rename.ts` +
`run-edit` spec). Its experiment-doc counterpart was never written,
even though renaming experiments is plausibly more common than
renaming runs: an experiment lives for the entire lifetime of an
investigation, and the slug is often the first thing the user wants
to revise as the work crystallises.

Today the only way to "rename" an experiment is to manually:

1. Rename the folder under `docs/experiments/`.
2. Hand-edit the exp doc's `id` and `slug` frontmatter.
3. Find every member run and rewrite each run README's `experiment:`
   frontmatter.
4. Find every hypothesis in `docs/hypotheses.md` that lists the old
   exp id and rewrite both the summary table and the per-H section.

Doing this safely is fiddly enough that even a careful user will
sometimes leave dangling refs (a phantom `experiment:` on a run, a
hypothesis row with a now-non-existent E-id). The atomic-write
optimistic-mtime-lock plumbing the rest of the codebase uses for
similar multi-file mutations is not available outside of CLI/web code,
and ad-hoc shell scripts don't replicate it.

This change adds the missing `memon experiment rename` CLI command
together with the underlying `renameExperiment` core helper, matching
the surface area of `memon run rename` as closely as practical.

Scope is **CLI + core only**, parallel to how `run rename` is also
CLI-only (no `POST /api/runs/:id/rename` endpoint exists). Web API
and dashboard UI for exp rename are deferred to follow-up changes per
the existing project convention of splitting runtime+UI from skills
updates — and within runtime, deferring web/UI work behind a verified
CLI baseline.

## What Changes

### Core: new `renameExperiment` helper

- New module `packages/core/src/experiments/rename.ts` exporting
  `renameExperiment(projectRoot, projectName, oldIdOrSlug, newSlug,
  options?): Promise<RenameExperimentResult>` where:
  - `oldIdOrSlug` is resolved to a canonical `E<NNNN>-<slug>` via
    `resolveExperimentId` (NOT_FOUND when no match).
  - `newSlug` is validated against `^[a-z0-9][a-z0-9-]*[a-z0-9]?$` and
    must not include a trailing `-<YYMMDD>-<HHMMSS>` suffix (same
    SLUG_RE shape `run-rename` uses).
  - The function SHALL refuse and return `BAD_REQUEST` /
    `EXPERIMENT_SLUG_PREFIX_COLLISION` when any *other* existing
    experiment has slug equal to `newSlug`, or where one slug is a
    prefix of the other (the same rule
    `experiment-edit/spec.md`'s `experiment create` uses).
  - On idempotent input (`newSlug === oldSlug`), the function SHALL
    return `{ ok: true, oldId, newId: oldId, noop: true }` without
    touching disk.
- The function SHALL perform the rename in this order:
  1. **Folder rename**: `fs.rename(oldFolderPath, newFolderPath)`.
     For v5 records the folder is `dirname(exp.path)`. For legacy v4
     records (`exp.path` ends in `${oldId}.md`), the rename targets
     the single file (`oldPath` → `<dir>/<newId>.md`).
  2. **Exp README frontmatter rewrite**: open the new
     `<newFolder>/README.md` (or new `.md` for legacy), parse with
     `parseExperimentReadme`, set `frontMatter.id = newId`,
     `frontMatter.slug = newSlug`, `frontMatter.updatedAt = nowIso()`,
     re-serialize via `serializeExperimentReadme`, atomic-write back.
  3. **Bound run rewrites**: for each id in
     `exp.frontMatter.runs`, resolve the run via
     `scanProjectRoot`, parse its README, set
     `frontMatter.experiment = newId` (only when the current value
     equals `oldId` — leave unrelated mismatches alone, the user can
     reconcile with `experiment unlink` / `link`), bump
     `updated_at`, atomic-write.
  4. **Hypotheses rewrite**: read `docs/hypotheses.md`, do a literal
     token substitution of `oldId` → `newId` over the body
     (`E<NNNN>-<slug>` ids are unique tokens — the `E\d{4}-` prefix
     guarantees no substring collision with prose words; the
     `[\b]` token boundary is enforced via a regex that requires
     non-`[a-z0-9-]` neighbors). Atomic-write only if the content
     actually changed.
  5. **JOURNAL append**: one `[RENAME]` event whose body is
     `op=experiment-rename old=<oldId> new=<newId>`.
- The function SHALL emit a soft warning (returned in the result) when
  any member run's slug does NOT start with `newSlug` (the same
  `RUN_SLUG_PREFIX_VIOLATION` `experiment link` and `run rename`
  emit as soft warnings).
- The function SHALL NOT add automatic rollback on partial failure.
  A halt mid-way leaves an inconsistent state the user resolves via
  git (the runtime already requires git for migrations; this aligns
  with that posture). The implementation order above is chosen so
  that the most user-visible step (folder rename) happens first; if
  later steps fail, the user sees the partially renamed state on `ls`
  and knows where to look.

### CLI: `memon experiment rename` command

- New file `packages/cli/src/commands/experiment-rename.ts` exporting
  `runExperimentRename(input)` that wraps `renameExperiment`.
- Wire under `experiment.command('rename <id-or-slug> <new-slug>')` in
  `packages/cli/src/index.ts`. The command takes no flags beyond the
  global `--project-root` / `--project`.
- The command SHALL emit JSON on stdout in the same shape as `run
  rename`: `{ ok: true, oldId, newId, noop?, warnings? }`. Warnings
  (soft prefix violation, etc.) go to stderr as one-line
  `{warning:{code, message}}` JSON events in addition to being
  surfaced in stdout `warnings: []`.

### Tests

- `packages/core/src/experiments/rename.test.ts` — happy path,
  slug-collision rejection, prefix-collision rejection, noop on same
  slug, bound-run rewrites, hypotheses rewrites, JOURNAL event,
  soft prefix-violation warning when a member run's slug doesn't
  start with the new exp slug.
- `packages/cli/src/commands/experiment-rename.test.ts` — happy path
  via the CLI's JSON output, NOT_FOUND on missing exp, exit code on
  collision.

### Spec deltas

- `experiment-edit`: ADD a new "Requirement: `memon experiment
  rename` allocates new slug, cascades exp-id rewrites, and updates
  hypotheses".
- `memon-cli`: MODIFY the `memon experiment subcommand family`
  requirement's command list to include `experiment rename
  <id-or-slug> <new-slug>` as a new row.
- `journal`: extend the `[RENAME]` event grammar to include
  `op=experiment-rename` alongside `op=run-rename`.

### Out of scope

- **Web API**: no `POST /api/experiments/:id/rename` endpoint in this
  change. Parallels `run rename`'s CLI-only posture. A follow-up may
  add the API once the CLI path is verified in real use.
- **Web UI**: no rename button / dialog. Follow-up after the API.
- **Skills**: no agent-skill bullets about "when to use rename" yet.
  Per `[[feedback_split_runtime_then_skills]]`, skill updates ride a
  separate change once the runtime stabilises.

## Capabilities

### New Capabilities
<!-- none — `experiment-edit` and `memon-cli` are existing capabilities; this just adds requirements under them. -->

### Modified Capabilities

- `experiment-edit`: gains a `memon experiment rename` requirement.
- `memon-cli`: gains `experiment rename` in the subcommand list.
- `journal`: extends the `[RENAME]` event body grammar.

## Impact

- `packages/core/src/experiments/rename.ts` (NEW)
- `packages/core/src/experiments/rename.test.ts` (NEW)
- `packages/core/src/experiments/index.ts` or `packages/core/src/index.ts` — re-export `renameExperiment`.
- `packages/cli/src/commands/experiment-rename.ts` (NEW)
- `packages/cli/src/commands/experiment-rename.test.ts` (NEW)
- `packages/cli/src/index.ts` — wire the new subcommand.
- `openspec/specs/experiment-edit/spec.md` — ADDED requirement.
- `openspec/specs/memon-cli/spec.md` — MODIFIED requirement (the
  subcommand family).
- `openspec/specs/journal/spec.md` — MODIFIED requirement (the
  event-grammar one).
- No web, no UI, no skills.
