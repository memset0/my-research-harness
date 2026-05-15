## 1. Core: `renameExperiment` helper

- [x] 1.1 Create `packages/core/src/experiments/rename.ts` that exports
  `renameExperiment(projectRoot, projectName, oldIdOrSlug, newSlug,
  options?): Promise<RenameExperimentResult>` and the
  `RenameExperimentResult` type:
  ```ts
  export interface RenameExperimentResult {
    ok: true
    oldId: string
    newId: string
    noop?: boolean
    /** Soft warnings — currently only RUN_SLUG_PREFIX_VIOLATION. */
    warnings: { code: string; runId?: string; message: string }[]
  }
  export class RenameExperimentError extends Error {
    constructor(public code:
      | 'BAD_REQUEST'
      | 'NOT_FOUND'
      | 'EXPERIMENT_SLUG_PREFIX_COLLISION'
      | 'BAD_STATE',
      message: string,
      public extra?: Record<string, unknown>,
    ) { super(message) }
  }
  ```
- [x] 1.2 Implement the validation block:
  - SLUG_RE: `^[a-z0-9][a-z0-9-]*[a-z0-9]?$`; reject `BAD_REQUEST` on
    no match.
  - Reject `BAD_REQUEST` when `newSlug` contains a trailing
    `-\d{6}-\d{6}` (timestamp tail).
  - Resolve `oldIdOrSlug` via `resolveExperimentId(projectRoot, ...)`;
    reject `NOT_FOUND` when null.
  - Read the exp doc via `readExperimentDoc(projectRoot, projectName, oldId)`;
    `NOT_FOUND` if returned null.
  - Compute `newId = E<oldNNNN>-<newSlug>` (extract NNNN from the
    canonical oldId).
  - When `newSlug === oldSlug`, return noop result.
- [x] 1.3 Implement the slug-uniqueness preflight:
  - Call `discoverExperiments(projectRoot, projectName)`.
  - For every OTHER experiment record `e` (exclude self by id):
    - If `e.frontMatter.slug === newSlug` → reject
      `EXPERIMENT_SLUG_PREFIX_COLLISION` with the conflicting id.
    - If `newSlug.startsWith(e.frontMatter.slug + '-')` OR
      `e.frontMatter.slug.startsWith(newSlug + '-')` → reject
      `EXPERIMENT_SLUG_PREFIX_COLLISION`.
    (Equivalent to the rule in `experiment-edit` for `create`.)
- [x] 1.4 Implement the folder/file rename (step 6 of the requirement):
  - If `exp.path.endsWith(\`${oldId}.md\`)` → legacy v4 file form;
    rename `exp.path` to its sibling at `${newId}.md`.
  - Else → v5 folder form; rename `dirname(exp.path)` to its sibling
    at `${newId}`.
  - Capture `newReadmePath` accordingly (`<newFolder>/README.md` for
    v5, `<newFile>` for legacy v4).
- [x] 1.5 Implement the exp README frontmatter rewrite (step 7):
  - Read `newReadmePath`, parse via `parseExperimentReadme`, set
    `frontMatter.id = newId`, `frontMatter.slug = newSlug`,
    `frontMatter.updatedAt = nowIso()`, atomic-write the
    re-serialized output via `serializeExperimentReadme`.
- [x] 1.6 Implement the bound-run rewrites (step 8):
  - For each id in `exp.frontMatter.runs`:
    - Resolve the run dir record via `scanProjectRoot(projectRoot,
      { includeArchived: true })`.
    - If the run's `frontMatter.experiment === oldId`, parse the run
      README, set `frontMatter.experiment = newId`, bump
      `updated_at`, atomic-write.
    - If the run is unresolvable OR mismatches, log a debug-level
      note but don't reject (mismatch is the same drift state
      `experiment delete` tolerates).
- [x] 1.7 Implement the hypotheses substitution (step 9):
  - Build the regex `new RegExp(\`(?<![A-Za-z0-9-])${escapeRegex(oldId)}(?![A-Za-z0-9-])\`, 'g')`.
  - Read `<projectRoot>/docs/hypotheses.md`. If the file does not exist,
    skip silently. If it exists, run the replace; if the resulting
    content equals the original, skip the write. Otherwise atomic-write.
- [x] 1.8 Implement the soft prefix-violation warnings (cross-cutting
  with step 8): for each bound run whose slug (parsed via
  `parseSlugFromRunDir`) does NOT start with `newSlug`, append a
  `{ code: 'RUN_SLUG_PREFIX_VIOLATION', runId, message }` entry to
  the result's `warnings` array.
- [x] 1.9 Implement the JOURNAL append (step 10):
  - `appendJournalEvent({ path: join(projectRoot, 'docs', 'journal.md'),
    event: { timestamp: nowIso(), tag: 'RENAME', body:
    \`op=experiment-rename old=${oldId} new=${newId}\` } })`.
- [x] 1.10 Re-export `renameExperiment` and `RenameExperimentError`
  from `packages/core/src/index.ts`.

## 2. Core: tests for `renameExperiment`

- [x] 2.1 Create `packages/core/src/experiments/rename.test.ts` with a
  shared `seedExp` helper that scaffolds a temp project root with an
  exp folder, optional bound runs, optional hypotheses.md content.
- [x] 2.2 Test cases (one `it` block per scenario in the spec):
  - Happy path: renaming `E0001-foo` with two bound runs and a
    hypothesis mention rewrites all four file groups + appends the
    JOURNAL event.
  - Noop on same slug.
  - Slug-collision (`bar` already taken).
  - Prefix-collision (`foo-bar` exists, new `foo-baz` rejected; OR
    `foo-bar` exists, new `foo` rejected).
  - Invalid SLUG_RE shape.
  - Timestamp tail in newSlug.
  - NOT_FOUND on missing oldId.
  - Member-run prefix-violation soft warning.
  - Idempotent re-run on already-renamed state.
  - Hypotheses-substitution noop (file exists but doesn't mention id;
    no write performed; mtime unchanged).
  - Legacy v4 fallback (mid-migration): exp at
    `docs/experiments/E0001-foo.md` (no folder), rename succeeds and
    produces `docs/experiments/E0001-zero.md`.

## 3. CLI: `memon experiment rename` command

- [x] 3.1 Create `packages/cli/src/commands/experiment-rename.ts`
  exporting `runExperimentRename(input)`:
  ```ts
  export interface ExperimentRenameInput {
    projectRoot?: string
    cwd: string
    idOrSlug: string
    newSlug: string
  }
  export async function runExperimentRename(input: ExperimentRenameInput): Promise<void>
  ```
  - Resolve context, call `renameExperiment`, catch
    `RenameExperimentError` and route through `emitErrorAndExit` with
    the matching code; on warnings, write each as a one-line stderr
    JSON event AND include them in stdout `warnings` field.
  - Successful response: `emitJson({ ok: true, oldId, newId, ...(noop && {noop:true}), ...(warnings.length && {warnings}) })`.
- [x] 3.2 Wire under `experiment.command('rename <id-or-slug> <new-slug>')`
  in `packages/cli/src/index.ts` (after the `create` command block,
  before `link`). Include a one-line `.description(...)` similar to
  `run rename`'s.
- [x] 3.3 Add the import line for `runExperimentRename` in
  `packages/cli/src/index.ts`.

## 4. CLI: tests for `experiment rename`

- [x] 4.1 Create `packages/cli/src/commands/experiment-rename.test.ts`
  mirroring the structure of `warning.test.ts`:
  - Happy path JSON output.
  - NOT_FOUND on missing exp.
  - EXPERIMENT_SLUG_PREFIX_COLLISION exit code (2).
  - Prefix-violation warning surfaces on stderr.
  - Re-run is noop.

## 5. Verification

- [x] 5.1 `pnpm --filter @memon/core typecheck` clean.
- [x] 5.2 `pnpm --filter @memon/core test` passes, including the new
  `rename.test.ts`.
- [x] 5.3 `pnpm --filter @memon/cli test` passes, including the new
  `experiment-rename.test.ts`.
- [x] 5.4 `pnpm --filter @memon/web typecheck` clean (the change does
  NOT touch web; verify it still typechecks after the core re-export).
- [x] 5.5 `pnpm --filter @memon/core build && pnpm --filter @memon/cli build`
  produce fresh dist/ artifacts. (CLI build may surface a pre-existing
  typecheck error in `index-builder.test.ts` from the in-flight
  add-git-status-display change; that error is unrelated to this
  change and may be ignored if it's the only failure.)
- [x] 5.6 Smoke test against the repo's `mock/project-a/` (which has
  `E0001-vpred-convergence` with two bound runs and a hypothesis
  reference). DO NOT actually commit the rename — `git restore` after:

  ```bash
  pnpm --filter @memon/core build
  pnpm --filter @memon/cli build
  node packages/cli/dist/index.js experiment rename E0001-vpred-convergence vpred-conv-smoke --project-root mock/project-a
  # Verify by hand:
  ls mock/project-a/docs/experiments/
  grep -n 'experiment: ' mock/project-a/*-260*-*/README.md 2>/dev/null
  grep -n 'E0001-' mock/project-a/docs/hypotheses.md
  # Revert the smoke change:
  git restore mock/project-a/
  git clean -fd mock/project-a/docs/experiments/E0001-vpred-conv-smoke 2>/dev/null
  git restore mock/project-a/
  ```

- [x] 5.7 `openspec validate add-experiment-rename --type change` is
  clean.
