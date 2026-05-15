## 1. Core: rewrite `id.ts` for v5

- [x] 1.1 Update `packages/core/src/experiments/id.ts` import line: add
  `EXPERIMENT_DIR_REGEX` alongside the existing `EXPERIMENT_FILENAME_REGEX`
  (both come from `../types.js`).
- [x] 1.2 Rewrite `nextExperimentId(projectRoot)`:
  - Keep `readdir(<projectRoot>/docs/experiments/)` as the entry-point;
    keep the `ENOENT → 'E0001'` early-return.
  - In the loop, accept the entry's NNNN if either
    `entry.match(EXPERIMENT_DIR_REGEX)` (v5 folder) OR
    `entry.match(EXPERIMENT_FILENAME_REGEX)` (v4 file, legacy fallback)
    succeeds. Use whichever regex matched to extract `m[1]` (the
    4-digit string), then feed through `parseId('E' + m[1])` as today.
  - Allocation = `padId('E', max + 1)` over the union of both forms.
  - Update the JSDoc to say "Scan `docs/experiments/` for existing
    `E<NNNN>-<slug>/` folders (post-v5) and legacy `E<NNNN>-<slug>.md`
    files (v4 fallback), returning `padId('E', max+1)`."
- [x] 1.3 Rewrite `resolveExperimentId(projectRoot, needle)`:
  - Keep `readdir(...)` + `ENOENT → null` early-return.
  - **Full-id form** (`/^E\d{4}-/.test(needle)`): build the candidate
    set `[needle, ${needle}.md]` and return `needle` if `entries`
    includes either; else `null`. (Drops the v4-only
    `entries.includes(`${needle}.md`)` check.)
  - **Bare-slug form**: iterate entries, try
    `EXPERIMENT_DIR_REGEX.exec(entry)` first then
    `EXPERIMENT_FILENAME_REGEX.exec(entry)`; on either match extract
    `m[1]` (NNNN) and `m[2]` (slug). Build a match list of
    `E<NNNN>-<slug>` for every entry where `m[2] === needle`. Return
    the single match (or `null` for zero / multi).
  - Update the JSDoc accordingly.
- [x] 1.4 Remove the obsolete inline comment at line 15 of `id.ts` that
  says "Scan `<projectRoot>/docs/experiments/` for existing
  `E<NNNN>-<slug>.md` files" — replace with v5 wording.

## 2. Tests: rewrite fixtures + add legacy-fallback case

- [x] 2.1 In `packages/core/src/experiments/id.test.ts`, rewrite the
  `nextExperimentId` `beforeEach` / per-test fixture seeding to create
  v5-shape folders: for each id, `await fs.mkdir(join(dir, id),
  {recursive: true})` then `await fs.writeFile(join(dir, id,
  'README.md'), '')`. Keep existing assertions.
- [x] 2.2 Rename the existing v4 "ignores non-canonical filenames"
  test to "ignores non-canonical entries", seed the same noise mix
  (`README.md`, `E1`, `foo`, `E0002`) as either files or folders, and
  assert the allocator returns `E0002` (because only the one valid
  `E0001-foo/` folder counts toward NNNN).
- [x] 2.3 ADD a new test in the `nextExperimentId` block:
  `it('counts both v5 folders and legacy v4 .md files toward max',
  ...)` — seed `E0001-foo/README.md` (v5) AND `E0002-bar.md` (legacy
  v4 file) AND `E0007-baz/README.md` (v5); assert `nextExperimentId`
  returns `'E0008'`.
- [x] 2.4 Rewrite the `resolveExperimentId` `beforeEach` block to seed
  v5 folders for `E0001-fsdp-coll`, `E0002-attention`, `E0003-fsdp-bug`.
  Keep the four existing tests (full id, unique slug, ambiguous slug,
  no match, missing dir) — they should pass with the v5 fixtures.
- [x] 2.5 ADD a new test in the `resolveExperimentId` block:
  `it('resolves a slug from a legacy v4 .md file during migration',
  ...)` — seed `E0001-foo/README.md` (v5) AND `E0002-legacy.md`
  (legacy); call `resolveExperimentId(root, 'legacy')` and assert
  result `'E0002-legacy'`. Also call `resolveExperimentId(root,
  'E0002-legacy')` and assert it returns `'E0002-legacy'` (full-id
  form against legacy file).

## 3. Verification

- [x] 3.1 `pnpm --filter @memon/core typecheck` passes.
- [x] 3.2 `pnpm --filter @memon/core test` passes (id.test.ts in
  particular).
- [x] 3.3 `pnpm --filter @memon/cli test` passes (the CLI's experiment
  create lifecycle test exercises `nextExperimentId` end-to-end).
- [x] 3.4 `pnpm --filter @memon/web typecheck` passes.
- [x] 3.5 `pnpm --filter @memon/core build` succeeds (the CLI imports
  the built artifact at runtime).
- [x] 3.6 Sanity-check against the repo's `mock/project-a/` (a real v5
  project root with `E0001..E0005` folders). From repo root:

  ```bash
  pnpm --filter @memon/core build
  node -e "
    import('./packages/core/dist/experiments/id.js').then(async m => {
      console.log('next:', await m.nextExperimentId('mock/project-a'))
      console.log('zero-snr-eval:', await m.resolveExperimentId('mock/project-a', 'zero-snr-eval'))
      console.log('E0001-vpred-convergence:', await m.resolveExperimentId('mock/project-a', 'E0001-vpred-convergence'))
      console.log('nonexistent:', await m.resolveExperimentId('mock/project-a', 'nonexistent'))
    })
  "
  ```

  Expected output:

  ```
  next: E0006
  zero-snr-eval: E0002-zero-snr-eval
  E0001-vpred-convergence: E0001-vpred-convergence
  nonexistent: null
  ```

- [x] 3.7 `openspec validate fix-experiment-id-v5-readdir --type change`
  is clean.
