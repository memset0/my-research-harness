# Design — add-experiment-rename

## D1. Why CLI-only, no web API or UI in this change

`memon run rename` shipped CLI-only and has lived comfortably without a
web equivalent. The natural user is an agent or shell user who knows
the slug they want; mouse-driven rename from the dashboard is
nice-to-have but not blocking. Following that same pattern keeps the
runtime surface small and lets us verify the cascade logic (folder +
exp README + bound run READMEs + hypotheses + JOURNAL) end-to-end via
the CLI before exposing it on a button. Anything later (web API, drawer
dialog) lands incrementally as separate changes.

The user's [[feedback_split_runtime_then_skills]] applies a similar
"smaller steps verified first" posture: runtime first, skills second.
Within runtime, I'm extending that to "CLI first, web second".

## D2. Why string-substitute hypotheses.md instead of parse+serialize

`packages/core/src/hypotheses/parse.ts` exposes `parseHypotheses` but
NO `serializeHypotheses`. The file is a long-form authored Markdown
document with a structured Summary table on top and per-H sections
below — both are human-readable and human-edited. Round-tripping
through a parser would have to preserve formatting choices (column
widths, blank lines, sub-section ordering, author's prose) that the
parse step doesn't capture.

The pragmatic alternative is string substitution of `oldId` (a unique
`E<NNNN>-<slug>` token) with `newId`. Token uniqueness is guaranteed
because:

- `E<NNNN>-<slug>` is anchored: any occurrence in prose must include
  the `E\d{4}-` prefix.
- `slug` is `[a-z0-9-]+`, so neighboring characters are alphanumeric
  word characters; a word-boundary regex (`\bE0001-foo\b`) is
  sufficient to avoid false-positive partial matches inside other
  tokens.

Edge case: a hypothesis's prose mentions the old id in narrative text
("we tried E0001-foo earlier..."). The substitution rewrites those too.
This is acceptable because:

1. Hypothesis narrative referring to an exp id IS a reference to the
   experiment, so a rename SHOULD propagate.
2. The user can audit via `git diff docs/hypotheses.md` after the
   rename and revert any narrative substitution they don't want.

If a hypothesis NEVER mentions the old id (no Experiments: row, no
prose), the substitution is a no-op for that file (`content ===
newContent`), and the file's mtime is left untouched.

## D3. Soft warning for run-slug prefix violation

The existing `experiment link` and `run rename` commands print a
`RUN_SLUG_PREFIX_VIOLATION` warning when a member run's slug doesn't
start with the experiment's slug. The same rule applies post-rename:
if `E0001-foo` is renamed to `E0001-bar` and a member run is named
`foo-260501-100000`, the new exp slug (`bar`) is no longer a prefix
of the run slug (`foo`). This is non-blocking — user might intentionally
rename to a slug that doesn't match the historical run slugs, e.g.
because the exp's scope shifted.

The warning is surfaced in two places:
- Stderr: one-line `{warning:{code:'RUN_SLUG_PREFIX_VIOLATION',
  message:'...'}}` JSON event per offending run.
- Stdout: included in the success JSON as
  `warnings: [{code, runId, message}, ...]`.

## D4. Atomicity / partial-failure posture

The rename touches up to N+3 files (folder rename + exp README + N
run READMEs + hypotheses + JOURNAL). Full ACID is out of reach without
either a transaction layer or a write-everything-to-temp-then-rename
mass-flip — both significant complexity for a low-frequency operation.

Instead, the implementation:
1. **Validates everything up front** (slug shape, slug uniqueness,
   prefix collisions, exp existence). The fast-fail path leaves disk
   untouched.
2. **Performs writes in a documented order** (folder → exp README →
   run READMEs → hypotheses → JOURNAL) so a partial failure is
   recoverable. The folder rename happens first because it's the most
   visible change — a halt after step 1 leaves an obvious "old folder
   is gone, but `runs[].experiment:` still says the old id" state the
   user can grep for.
3. **Emits no rollback** — the user inspects via `git diff`, fixes
   whatever's stuck, and re-runs (the rename is idempotent on
   already-renamed input — step 1's folder check sees the new folder
   and the old is absent; step 2's frontmatter check sees the new id;
   step 3 sees `experiment: newId` and skips the rewrite).

This matches the posture of `migrate-fs-runtime`: "the user is
responsible for not running the migration twice in parallel, and for
recovering via `git restore` if a step fails partway".

## D5. Path detection for v4 fallback

`readExperimentDoc` and `discoverExperiments` already tolerate the v4
legacy file form (`docs/experiments/E0001-foo.md`) during the
migration window. The rename logic uses the same `exp.path.endsWith(
\`${oldId}.md\`)` check `experiment delete` uses (line 540 of
`experiment-doc.ts`) to branch into the legacy path:

- **v5 folder**: `fs.rename(dirname(exp.path), <projectRoot>/docs/
  experiments/<newId>)`. The README path inside is unchanged
  (`<newFolder>/README.md`).
- **v4 file**: `fs.rename(exp.path, <projectRoot>/docs/experiments/
  <newId>.md)`. No folder, no README inside.

The exp README rewrite (step 2 above) opens the post-rename path
either way.

## D6. Why not include a `--force` flag

`memon run rename` and `memon experiment delete` both took
`--force`-style flags to suppress prompts. `memon experiment rename`
doesn't need one because:

- There's no destructive operation that would benefit from a
  confirmation prompt (the rename is recoverable via git, and the
  validate-first posture catches collisions before any disk write).
- There's no "non-README content in the folder" risk the way `delete
  --force` exists to handle — rename just moves the folder, scratch
  content rides along.

If a future use case appears (e.g. "the new slug collides with an
archived run's slug, suppress the warning"), `--force` can be added
in a follow-up.

## D7. Out of scope explicit list

- No `POST /api/experiments/:id/rename` web endpoint (separate change).
- No dashboard rename dialog (separate change).
- No agent-skill bullets about when to rename (separate change per
  `[[feedback_split_runtime_then_skills]]`).
- No `--force` flag.
- No automated `git mv` invocation when the project is a git repo. The
  user's git workflow handles the rename via `git status` after the
  fact; we don't try to be a git porcelain.
