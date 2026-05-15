## 1. CLI: index.ts descriptions and regex idioms

- [x] 1.1 In `packages/cli/src/index.ts`, update the import line for
  `@memon/core` to include `EXPERIMENT_DIR_REGEX`. Keep
  `EXPERIMENT_FILENAME_REGEX` only if other references remain in the
  file after the changes below; otherwise remove it from the import
  list (the type isn't used elsewhere — confirm via grep on the
  finished file).
- [x] 1.2 Line 228 — change the `.description(…)` on the `experiment`
  parent command from
  `'experiment-doc commands (v3 docs/experiments/E<NNNN>-<slug>.md)'` to
  `'experiment-doc commands (docs/experiments/E<NNNN>-<slug>/README.md)'`.
- [x] 1.3 Line 248 — change the `.description(…)` on `experiment
  create` from
  `'allocate next E<NNNN> and write docs/experiments/E<NNNN>-<slug>.md'`
  to
  `'allocate next E<NNNN> and write docs/experiments/E<NNNN>-<slug>/README.md'`.
- [x] 1.4 Line 318 (inside `experiment status set <id>` action) —
  replace
  `if (\`${id}.md\`.match(EXPERIMENT_FILENAME_REGEX)) {`
  with
  `if (EXPERIMENT_DIR_REGEX.test(id)) {`.
- [x] 1.5 Line 469 (inside `experiment archive <id>` action) — same
  replacement as 1.4.
- [x] 1.6 Line 487 (inside `experiment unarchive <id>` action) — same
  replacement as 1.4.
- [x] 1.7 Line 336 — update the error string from
  `id "${id}" matches neither EXPERIMENT_FILENAME_REGEX (E<NNNN>-<slug>) nor RUN_DIR_REGEX (<slug>-<YYMMDD>-<HHMMSS>)`
  to
  `id "${id}" matches neither EXPERIMENT_DIR_REGEX (E<NNNN>-<slug>) nor RUN_DIR_REGEX (<slug>-<YYMMDD>-<HHMMSS>)`.

## 2. CLI: experiment-doc.ts header comment

- [x] 2.1 Replace the existing header comment (lines 1-5) in
  `packages/cli/src/commands/experiment-doc.ts` with v5-accurate
  wording:

  ```ts
  // memon experiment {ls, show, create, link, unlink, delete} — exp-doc commands.
  //
  // These operate on `<projectRoot>/docs/experiments/E<NNNN>-<slug>/README.md`
  // (v5 folder layout). Run-level operations (status set / readme write /
  // archive / unarchive) live in experiment.ts (legacy file name from a
  // pre-v3 rename pass); run rename lives in run-rename.ts. There is no
  // experiment-rename command yet.
  ```

## 3. Verification

- [x] 3.1 `pnpm --filter @memon/cli test` still passes (no behavior
  change — all existing tests should remain green).
- [x] 3.2 `pnpm --filter @memon/core test` still passes (sanity).
- [x] 3.3 `grep -nE '\\\${id}\\.md\\\`\\.match' packages/cli/src/index.ts`
  returns no matches (the legacy idiom is gone).
- [x] 3.4 `grep -n 'EXPERIMENT_FILENAME_REGEX' packages/cli/src/index.ts`
  returns no matches (the v4 regex is no longer referenced from
  `index.ts`).
- [x] 3.5 `grep -n 'docs/experiments/E<NNNN>-<slug>\\.md' packages/cli/src/`
  returns at most ONE match, and it is the comment in `warning.ts`
  that intentionally documents the legacy-v4 file-form fallback
  supported by the v5-aware discovery helper. Every other v4
  file-form reference is gone.
- [x] 3.6 `openspec validate cleanup-stale-v4-comments --type change`
  is clean.
