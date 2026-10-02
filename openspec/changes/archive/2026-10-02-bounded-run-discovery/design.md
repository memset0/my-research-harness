## Context

See proposal.md (Why). The walk (`discoverRuns`) already lists only `logs/`, `outputs/` and `experiments/`, stops at every Run-shaped name (no README required) and recurses without a depth limit. Projects configure only `include` / `exclude`. Membership (`computeMembership`) is a synchronous join over the walked Run list, so any directory the walk does not reach becomes a `PHANTOM_RUN_REF`, and the canonical spec text still lists "directory without a README" as a phantom trigger although the code treats such a discovered directory as a member. The CLI has no project-level configuration: every command synthesizes a Project from `--project-root` / cwd.

## Goals / Non-Goals

**Goals:** bound the walk per Project without changing any current discovery result by default; make phantom classification independent of walk pruning; keep the CLI able to use the same bound.

**Non-Goals:** changing the default discovery scope now; moving Runs or rewriting declarations; changing backend/Web call sites (owned by a concurrent change); caching or indexing Run paths.

## Decisions

1. **Non-nesting is pinned, not re-implemented.** The walk already never descends into a Run-shaped directory. The change makes it a requirement and adds a listing-count test over a counting fake `projectFs.readdir`, so any later "look inside Runs" regression fails loudly. Alternative (requiring a README before stopping) was rejected: it would list every README-less timestamp directory's outputs.

2. **`run_dirs` patterns instead of a depth.** A Project key `run_dirs: string[]` in `ProjectConfigRawSchema` (snake_case like every other Project key), surfaced as `ProjectConfig.runDirs`. Each pattern is split on `/`; segments are literals or single-segment globs (`*`, `?`, whole or partial such as `sweep-*`). `**`, `.`/`..`, absolute paths, backslashes and empty segments are rejected, and the first segment must be a literal Run root (`logs`/`outputs`/`experiments`) so every result is a valid project-relative Run path (`isRunPath`). One validator (`runDirPatternError`) serves the config schema and the CLI flag.
   - Expansion: start from the project root; a literal segment is checked with `lstat` (plain directory, not a symlink, not excluded); a glob segment lists each current prefix once (listings memoized per call, so overlapping patterns share them) and keeps directory entries whose names match, skipping dot names and excludes. Run-shaped names are never kept as intermediate prefixes (non-nesting). Directories matched by the last segment are candidate Runs when Run-shaped; others are reported through the optional `onPatternNonRun` callback (`RUN_DIR_PATTERN_NON_RUN`, lint level) and ignored. Listings ≤ Σ over patterns of the prefixes each glob segment is applied to; `["logs/*", "outputs/*"]` = 2 listings, `["outputs/*/*"]` = 1 + non-Run children of `outputs/`.
   - Absent `run_dirs` keeps the unbounded walk because changing it here would silently drop Runs from existing projects with deeper layouts; this change only gives operators the lever.
   - Alternative considered and replaced: a numeric `run_depth` (1|2). It could not express "deep only under one group" (`experiments/*/runs/*`) and still listed every non-Run directory at the allowed levels; it was never released, so it is removed rather than deprecated.

3. **8.0.0 plan.** The next filesystem-convention major is expected to make the non-nesting rule a convention and default `run_dirs` to `["logs/*", "outputs/*", "experiments/*"]`, with the migration moving deeper Runs (or requiring projects to declare their patterns) and rewriting declarations. That needs its own migration guide and is out of scope here.

4. **Bare-root callers take the patterns as an option.** `scanProjectRoot`, `RunTargetIndex.open` and `resolveRunTarget` accept `runDirs` and forward it to `discoverRuns`; `discoverRuns(project)` reads `project.runDirs`, so callers that already pass a configured `ProjectConfig` get it automatically. Project-relative path resolution never walks and ignores the patterns (`RunTargetIndex` falls back to direct path resolution for paths the walk did not reach).

5. **CLI flag, not CLI config.** The CLI removed config.yml support, so a repeatable global `--run-dir <pattern>` is validated once in a commander pre-action hook (before the invocation ledger touches the project) and exposed through a tiny module (`lib/discovery-options.ts`) that the scan, index builder and Run-target call sites spread into their options. Unset → no option → unbounded. Impact on CLI nodes: none unless an operator passes the flag; `memon update` picks up the new binary as a MINOR release.

6. **Direct-path phantom classification as an opt-in input.** `computeMembership` stays synchronous and gains `declaredRuns?: ReadonlyMap<string, Run | null>`: when supplied, every project-relative reference is looked up there (null → `PHANTOM_RUN_REF`), never in the walked list; base-name references still use the walked list. A new async `resolveDeclaredRuns({ projectRoot, project, experiments, runs })` builds that map: for each distinct declared path it runs the existing containment check (`resolveDeclaredRunPath`: realpath containment, directory check), reuses a walked Run record with the same path, or reads the directory with `readRunDir` (README-less → `hasReadme: false`); any failure maps to null. `computeMembershipFromDisk(input)` composes both. Without `declaredRuns` the old behaviour is kept, so backend/Web output does not change until they opt in; cost is one stat/realpath set per declared path, independent of project size.
   - Alternative: stat inside `computeMembership` (rejected: it would become async and break both existing synchronous callers owned by the concurrent change).

## Risks / Trade-offs

- [A Project declares `run_dirs` too narrowly and loses Runs from the list] → Declared Experiment members are still resolved by path and not reported as phantoms; only undeclared Runs outside the patterns disappear from the walk. Documented as the operator's choice.
- [Patterns whose literal first segment is excluded] → They match nothing; excludes keep their meaning rather than being overridden by a pattern.
- [Backend/Web keep the walk-based phantom rule until they adopt the helper] → Integration points listed in the apply report; the behaviour is unchanged rather than half-changed.
- [Direct-path reads add I/O to anomaly computation] → Bounded by the number of declared paths and only paid by callers that opt in.

## Migration Plan

No data migration. Releasing is a MINOR bump (core + CLI). Rollback is reverting the commits; a config carrying `run_dirs` is ignored by older versions (the Project schema strips unknown keys).

## Notes

- Data observation from an operator project (measured read-only): `logs/` has 1306 top-level directories, 9 of which are not Run-shaped (an 8-digit date such as `…-20260910-152156`, or a 4-digit time such as `…-260913-0000`); the unbounded walk recurses into each of them. `outputs/` holds 42,828 directories in total, 9,715 of them in a single cache-like subtree; that subtree is where the cost of unbounded recursion comes from. `run_dirs: ["logs/*"]` reduces such a walk to one listing.
