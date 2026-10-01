## Why

The 2026-09-30 repository audit found that `@memon/core` and its two Node
consumers (`@memon/cli`, `@memon/backend`) carry several hand-copied helpers
whose copies have already drifted apart:

- Slug, Run directory, Experiment directory and Run path patterns are defined
  in more than ten places with different semantics. Discovery accepts any
  `<name>-<YYMMDD>-<HHMMSS>` base name, while hypothesis, wiki and membership
  references only accept `[A-Za-z0-9_]` names, and hypothesis references
  reject one-character Experiment slugs that discovery accepts. A Run or
  Experiment can therefore be discovered and listed but not referenced.
- YAML frontmatter is split by seven different regular expressions with
  different BOM, CRLF, empty-block and terminator handling.
- Temp-file-plus-rename writes are re-implemented about sixteen times with
  different temp names and cleanup, and the local-offset `nowIso` helper is
  copied seven times next to the canonical `formatIsoLocal`.
- The git commit-marks and wiki review CSV parsers are identical copies, the
  `runGit` helper exists twice differing only in `maxBuffer`, and the v6→v7
  migration bypasses the shared git command runner.
- `project-file-store.ts` and `git/command.ts` import each other, and
  `types.ts` imports types back from the store.
- The root barrel exports legacy migration and cache helpers that no package
  consumes.
- The Run and Experiment frontmatter parsers keep diverging copies of
  `stringOr`, `stringArray` and hypothesis-reference validation; the
  Experiment copy silently drops non-string hypothesis elements.
- `packages/core/src/cli/` holds project-scan code used by Backend and Web,
  not CLI code, and the package boundary test checks only three files.

## What Changes

- Centralize slug, Run directory, Experiment directory, Run path and the
  corresponding mention-token patterns plus validators in `ids.ts`; every
  other location imports them. Reference-side checks accept every name
  discovery accepts; creating a new Experiment slug keeps its stricter rule
  through an explicit strict variant.
- Add one `splitFrontmatter` in core used by every hand-written splitter
  (wiki pages, code-review docs, Run frontmatter patching, deprecation flag
  reads, journal append, v6→v7 and Digest migrations). YAML parsing libraries
  stay as they are at each call site.
- Export one `writeFileAtomic(path, data, opts?)` from core (sibling temp
  file + rename, optional mode, optional fsync, temp removed on failure) and
  use it at every temp-file-plus-rename site in core, CLI, Backend and the two
  Web modules that carry their own copy; replace the `nowIso` copies with
  `formatIsoLocal`.
- Share one RFC 4180 CSV record parser/quoter in `git/csv.ts`, one `runGit`
  helper with a `maxBuffer` parameter, and route the v6→v7 migration git
  probes through `GitCommandRunner`.
- Break the store ↔ git command import cycle with a leaf project-file-context
  module and a change-listener registration; move the file-access option
  types into `types.ts`; guard both edges with an import-graph test.
- Stop root-exporting symbols with no consumer outside core (listed in
  design.md); the files stay.
- Share frontmatter field helpers between the Run and Experiment parsers;
  non-string `hypotheses` elements in Experiment frontmatter now produce the
  same `INVALID_HYPOTHESIS_REF` warning the Run parser emits.
- Rename `packages/core/src/cli/` to `packages/core/src/project-scan/` and
  widen the package boundary test to scan every source file.

No filesystem convention, CLI command, HTTP route or persisted format changes.
`FS_CONVENTION_VERSION` and `MEMON_RELEASE` are untouched by this change.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `run-discovery`: Run references (wiki sources and `@` references,
  hypothesis Run lists, membership slug checks, CLI arguments) accept every
  base name that Run discovery accepts.
- `experiment-discovery`: Experiment references accept every folder name
  Experiment discovery accepts, including one-character slugs; new slugs keep
  the stricter creation rule.
- `run-readme`: one frontmatter delimiting rule (BOM, CRLF, empty block,
  `---`/`...` terminator) applies to every Markdown document memon parses or
  patches by hand.
- `experiment-readme`: non-string `hypotheses` elements produce an
  `INVALID_HYPOTHESIS_REF` warning instead of being dropped silently.
- `project-file-store`: whole-file replacement writes are atomic sibling
  temp-file renames that never leave the temp file behind on failure.

## Impact

- Code: `packages/core/src/**` (ids, frontmatter, atomic write, git, store,
  parsers, index, `cli/` → `project-scan/`), `packages/cli/src/**`,
  `packages/backend/src/**`, `apps/web/lib/warnings.ts`,
  `apps/web/lib/server/reports.ts`.
- Public API: new core exports (`splitFrontmatter`, `writeFileAtomic`, id
  pattern helpers); a short list of unused root exports is removed.
- Release surfaces: CLI and central Web/Backend code change (MINOR for the
  release agent); no skills, no filesystem migration.
