## Why

A grep audit after the v4→v5 migration surfaced four kinds of stale
v4 references in the CLI that look — but don't behave — like bugs:

1. `packages/cli/src/index.ts:228` `.description(…)` for the
   `experiment` parent command reads:
   ```
   experiment-doc commands (v3 docs/experiments/E<NNNN>-<slug>.md)
   ```
   The path component is v4-shape. After v5 it should read
   `E<NNNN>-<slug>/README.md`.

2. `packages/cli/src/index.ts:248` `.description(…)` for `experiment
   create` reads:
   ```
   allocate next E<NNNN> and write docs/experiments/E<NNNN>-<slug>.md
   ```
   Same problem.

3. `packages/cli/src/index.ts:318, 469, 487` — three call sites detect
   "is this an exp id?" by `` `${id}.md`.match(EXPERIMENT_FILENAME_REGEX) ``,
   appending `.md` to the id specifically so the v4 regex matches. This
   works *by accident* — `EXPERIMENT_FILENAME_REGEX` ends in `\.md$` so
   the string concatenation makes the test pass for valid v5 exp ids.
   But it reads as if the code expects v4 file form. The simpler form
   `EXPERIMENT_DIR_REGEX.test(id)` is functionally identical, doesn't
   need the `\.md$` workaround, and the regex name aligns with v5
   reality.

4. `packages/cli/src/commands/experiment-doc.ts:3-5` header comment:
   ```
   // These operate on `<projectRoot>/docs/experiments/E<NNNN>-<slug>.md`. Run-level
   // operations (status set / readme write / archive / unarchive / rename) live in
   // experiment.ts (legacy file name) and run-rename.ts respectively.
   ```
   Wrong on two counts: the path is v4 form, and the parenthetical
   wrongly attributes "rename" to `experiment.ts` / `run-rename.ts`
   (no `experiment rename` command currently exists; rename only
   covers the run side via `run-rename.ts`).

None of these are *broken* against real v5 data — they just look like
they are. Fixing them is purely cosmetic / readability work, with no
behavior change and no spec change.

## What Changes

### CLI: replace stale path references and detection idiom

- `packages/cli/src/index.ts`:
  - Line 228 description: update path component to
    `docs/experiments/E<NNNN>-<slug>/README.md`. Also drop the `(v3 ...)`
    parenthetical; the prefix is misleading (we're on v5).
  - Line 248 description: same path update.
  - Lines 318, 469, 487: replace the `` `${id}.md`.match(EXPERIMENT_FILENAME_REGEX) ``
    idiom with `EXPERIMENT_DIR_REGEX.test(id)`. Add
    `EXPERIMENT_DIR_REGEX` to the `@memon/core` imports and remove
    `EXPERIMENT_FILENAME_REGEX` from the import list iff no remaining
    use exists in `index.ts` after the substitution.
  - Line 336 error message currently reads
    `id "${id}" matches neither EXPERIMENT_FILENAME_REGEX (...) nor RUN_DIR_REGEX (...)`.
    Update to name `EXPERIMENT_DIR_REGEX` instead.
- `packages/cli/src/commands/experiment-doc.ts`:
  - Header comment (lines 1-5): rewrite to reflect v5 path and drop
    the incorrect "rename" attribution. Replace with something like:
    ```
    // memon experiment {ls, show, create, link, unlink, delete} — exp-doc commands.
    //
    // These operate on `<projectRoot>/docs/experiments/E<NNNN>-<slug>/README.md`
    // (v5 folder layout). Run-level operations (status set / readme write /
    // archive / unarchive) live in experiment.ts (legacy file name from a
    // pre-v3 rename); run rename lives in run-rename.ts. There is no
    // experiment-rename command yet.
    ```

## Capabilities

### New Capabilities
<!-- none — this change is purely a comment + description + idiom cleanup; no requirements move. -->

### Modified Capabilities
<!-- none — no behavior change. -->

## Impact

- `packages/cli/src/index.ts` — small string + regex-call edits.
- `packages/cli/src/commands/experiment-doc.ts` — header comment.
- No tests, no specs, no UI. The behavior of all touched call sites
  is unchanged.
