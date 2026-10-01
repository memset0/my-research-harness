## Context

`@memon/core` is consumed by `@memon/cli`, `@memon/backend` and the central
Web app. The audit (2026-09-30, sections 1.3–1.5, 1.8–1.10, 2.10, 2.14)
found duplicated helpers whose copies have already diverged. Two other agents
are concurrently editing `apps/web/**` and `openspec/specs/**`, so this change
owns only `packages/{core,cli,backend}/**`, its own change folder, and the two
Web modules that carry a private atomic-write copy
(`apps/web/lib/warnings.ts`, `apps/web/lib/server/reports.ts`).

## Goals / Non-Goals

**Goals:**
- One definition per identifier pattern, frontmatter split, atomic write,
  CSV record parser and `runGit` helper.
- No reference check stricter than the matching discovery check.
- No import cycle between the file store and the git command layer.
- A smaller root export surface without a subpath-export redesign.

**Non-Goals:**
- Changing YAML libraries (gray-matter, js-yaml, `yaml`) at any call site.
- Replacing gray-matter's own splitting inside `parseReadme`,
  `parseExperimentReadme` and `parseJournal`.
- Subpath exports, splitting `project-file-store.ts`, or touching Web code
  beyond the two atomic-write modules.
- Any change to `FS_CONVENTION_VERSION`, `MEMON_RELEASE` or on-disk formats.

## Decisions

### D1 — Identifier patterns live in `ids.ts`

`ids.ts` gains the slug, Run and Experiment patterns and validators:

| Export | Pattern / rule | Source |
|---|---|---|
| `SLUG_REGEX`, `isSlug()` | `^[a-z0-9][a-z0-9-]*$` | `EXPERIMENT_DIR_REGEX` slug group (discovery) |
| `SLUG_STRICT_REGEX`, `isSlug(s, {strict:true})` | `^[a-z0-9][a-z0-9-]*[a-z0-9]$` | `memon experiment create` |
| `RUN_DIR_REGEX` | `^.+-\d{6}-\d{6}$` | Run discovery |
| `isRunDirName()` | `RUN_DIR_REGEX` and no `/` | discovery applied to a base name |
| `RUN_TIMESTAMP_TAIL_REGEX` | `-\d{6}-\d{6}$` | rename / slug extraction |
| `EXPERIMENT_DIR_REGEX`, `EXPERIMENT_FILENAME_REGEX` | `^E(\d{4})-([a-z0-9][a-z0-9-]*)(\.md)?$` | Experiment discovery |
| `EXPERIMENT_REF_REGEX` | `^(E\d{4})(?:-<slug>)?(?:\/(V\d{4}))?$` | wiki sources / `@` refs |
| `isRunPath()` | `logs|outputs|experiments/…/<run name>` with traversal guards | `experiments/run-path.ts` |
| `RUN_PATH_SHAPE_REGEX` | `^(logs|outputs|experiments)/(?:[^/]+/)*[^/]+-\d{6}-\d{6}$` | wiki `@` path refs, widened basename |
| `RUN_MENTION_SOURCE` | `[A-Za-z0-9_]+(?:-[A-Za-z0-9_]+)*-\d{6}-\d{6}` | legacy prose scanners |
| `EXPERIMENT_MENTION_SOURCE` | `E\d{4}-[a-z0-9](?:[a-z0-9-]*[a-z0-9])?` | hypothesis prose scanner, widened to 1-char slugs |
| `extractRunMentions()` | legacy scan + whole-token fallback | hypotheses, Report evidence |

`types.ts` re-exports the moved regexes under their old names so consumers
keep compiling. Semantics follow the most permissive existing variant:
reference-side checks (wiki `sources`/`@` refs, hypothesis lists, membership
slug check, wiki evidence check, CLI warning target) now accept what discovery
accepts. Only `memon experiment create` uses the strict slug variant.

Free-text scanning cannot use `.+` without swallowing surrounding prose, and
widening its character class is not monotone (`x→foo-…` would change what is
extracted). Scanners therefore keep the legacy token exactly and add a
whole-token fallback: a whitespace/comma-delimited token, stripped of wrapping
punctuation, that is a discoverable Run name is added only when the legacy
scanner found nothing inside it. Existing extractions are thus unchanged
(strict superset). Known limitation: a name whose suffix itself looks like a
legacy Run name (`a.b-260501-100000`) is still extracted as the suffix in
prose; explicit single-name fields (wiki `sources`, CLI arguments) accept it.

Out of scope for D1: Web-side copies (`apps/web/lib/artifact-links.ts`,
`markdown.tsx`), Report/code-review/wiki-page patterns (different id
families, already identical), and the backend code-review id pattern.

### D2 — One `splitFrontmatter`, YAML libraries unchanged

`frontmatter.ts` exports `splitFrontmatter(text)` returning
`{ status: 'none' }`, `{ status: 'unterminated', bom }` or
`{ status: 'ok', bom, raw, body, rawStart, rawEnd, bodyStart }`. Rule:
optional BOM, opener `---[ \t]*` + LF/CRLF, terminator = first line that is
`---` or `...` with optional trailing spaces/tabs, body = bytes after the
terminator line. Callers: `wiki/frontmatter.ts`, `code-review/parse.ts`,
`readme/frontmatter-patch.ts`, `discovery/deprecation.ts`,
`journal/append.ts`, `migrations/v6-to-v7.ts`. `migrations/digests-to-wiki.ts`
already splits through `parseWikiFrontmatter`; its extra
`/^\uFEFF?---/` "looks like frontmatter" refusal is kept on purpose, because
relaxing it would let a malformed Digest migrate as plain body text.

The previous splitters differed: wiki/code-review rejected a BOM and an empty
block (`---\n---`), accepted `\n---suffix` as a terminator; journal append
only recognised LF; v6→v7 rejected trailing whitespace after the closing
`---`. The unified rule accepts every well-formed block any of them accepted;
the only narrowing is the malformed `---suffix` pseudo-terminator, which no
memon writer produces.

**Why the YAML libraries are not swapped:** gray-matter (via js-yaml
JSON_SCHEMA), js-yaml and `yaml` disagree on timestamp coercion, anchors,
duplicate keys, `<<` merges and error recovery. `patchRunFrontMatter` and the
v6→v7 migration need `yaml`'s CST ranges to edit in place; wiki and
code-review rely on js-yaml JSON_SCHEMA to keep ISO timestamps as strings.
Swapping a library would change what is parsed and, through round-trip
writers, what is written back to disk. Only the delimiter logic is unified;
the existing `yaml-engine.ts` remains the js-yaml facade.

### D3 — `writeFileAtomic`

`atomic-write.ts` exports `writeFileAtomic(path, data, { mode?, fsync?, fs?,
mkdir? })`. Temp name: `.<basename>.<pid>.<time>.<random>.tmp` in the target
directory (no test depends on the old per-site suffixes, so names are
unified). Default fs is `projectFs` (native outside a project-file context,
identical to the previous CLI behaviour); sites that previously used
`node:fs` directly (journal append, v3→v4, Web warnings) pass that module as
`fs` to keep their routing; commit marks, wiki review, archive, deprecation,
Experiment rename, Report and Backend document writes keep `projectFs`.
fsync is off by default (NFS cost) and only performed when `fsync: true`.
On failure the temp file is removed. The seven `nowIso` copies become
`formatIsoLocal(new Date())`.

### D4 — Git helpers

`git/csv.ts` holds `parseCsvRecords` and `quoteCsvField`. `git/run.ts` holds
`runGit(exec, bin, args, cwd, timeoutMs, maxBuffer)` and the `ExecOk/ExecFail`
types; history keeps 8 MiB, submodules 4 MiB. The v6→v7 migration runs
`rev-parse --show-toplevel` and `status --porcelain` through a
`GitCommandRunner` (default `execFileGitCommand`, injectable via options).
Because those functions were synchronous inside an async function, the switch
only changes them to awaited calls.

### D5 — Breaking the store/git cycle

A leaf module `project-file-context.ts` owns the process-global
`AsyncLocalStorage<ProjectFileContext>` and a change-listener registry
(`onProjectFilesChanged`, `notifyProjectFilesChanged`), both on `globalThis`
symbols so duplicated bundles share them. The store uses the leaf's context
storage and notifies listeners where it called `invalidateGitOperations`;
`git/command.ts` reads the context from the leaf and registers
`invalidateGitOperations` as a listener at module load (the cache only exists
once that module is loaded). `ProjectFileContext` and `FileOperationReason`
live in the leaf module; `FileAccessOptions` and `FileCacheOptions` move to
`types.ts`. The store (and `project-file-cache.ts`) re-export all of them, so
the public API is unchanged. An import-graph test reads the source and asserts that
`git/command.ts` and `types.ts` import nothing from `project-file-store`, and
the store imports nothing from `git/`.

### D6 — Root exports

Each candidate named by the audit is grepped across `apps/`, `packages/`
(including `packages/skills/` and `.mjs`), and `scripts/`. A symbol with zero
references outside `packages/core/src` stops being root-exported; its file
stays. The final list is recorded in tasks.md.

### D7 — Shared frontmatter field helpers

`readme/fields.ts` exports `stringOr`, `stringArray` and
`validatedHypothesisRefs` (Run-side behaviour and messages). The Experiment
parser now warns on non-string `hypotheses` elements.

### D8 — `src/cli` → `src/project-scan`

Pure move plus import updates. `package-boundary.test.ts` scans every
non-test source file of core and backend for forbidden imports
(`next`, `react`, `apps/web`, human-auth modules) instead of three files.

## Risks / Trade-offs

- [Wider reference checks surface new anomalies, e.g. `RUN_SLUG_PREFIX_VIOLATION`
  for Runs that were silently skipped] → intended; it only reports, never
  blocks.
- [Unified frontmatter rule recognises `...` as terminator in wiki pages] →
  `...` alone on a line is a YAML document end marker and never valid inside
  a frontmatter mapping, so no existing page changes meaning.
- [Moving the context storage to a leaf module could split context across
  duplicated bundles] → both carriers use `Symbol.for` keys on `globalThis`.
- [Removing root exports may break an out-of-tree script] → only symbols with
  zero repository references are removed; files remain importable via dist
  paths.
