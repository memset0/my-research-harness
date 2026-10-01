## Context

See proposal.md (Why). The walk (`discoverRuns`) already lists only `logs/`, `outputs/` and `experiments/`, stops at every Run-shaped name (no README required) and recurses without a depth limit. Projects configure only `include` / `exclude`. Membership (`computeMembership`) is a synchronous join over the walked Run list, so any directory the walk does not reach becomes a `PHANTOM_RUN_REF`, and the canonical spec text still lists "directory without a README" as a phantom trigger although the code treats such a discovered directory as a member. The CLI has no project-level configuration: every command synthesizes a Project from `--project-root` / cwd.

## Goals / Non-Goals

**Goals:** bound the walk per Project without changing any current discovery result by default; make phantom classification independent of walk pruning; keep the CLI able to use the same bound.

**Non-Goals:** changing the default depth now; moving Runs or rewriting declarations; changing backend/Web call sites (owned by a concurrent change); caching or indexing Run paths.

## Decisions

1. **Non-nesting is pinned, not re-implemented.** The walk already never descends into a Run-shaped directory. The change makes it a requirement and adds a listing-count test over a counting fake `projectFs.readdir`, so any later "look inside Runs" regression fails loudly. Alternative (requiring a README before stopping) was rejected: it would list every README-less timestamp directory's outputs.

2. **`run_depth` is `1 | 2 | absent`, absent = unbounded.** A Project key in `ProjectConfigRawSchema` (snake_case like every other Project key), surfaced as `ProjectConfig.runDepth?: 1 | 2`. The walk carries a level per directory: entry directories are level 0, their children level 1; a child at level `runDepth` is recorded if Run-shaped and never queued for listing. With `runDepth = 1` only entry directories are listed; with `2` entry directories plus their non-Run, non-excluded children. Unbounded stays the default because changing it here would silently drop Runs from existing projects that use deeper layouts; this change only gives operators the lever.
   - Alternatives: a free integer (rejected: the measured layouts need 1 or 2 and a small closed set keeps the 8.0.0 convention honest); defaulting to 2 now (rejected: behaviour change outside a major release).

3. **8.0.0 plan.** The next filesystem-convention major is expected to make the non-nesting rule a convention and default `run_depth` to 2 (Runs at `logs/<run>` or `logs/<group>/<run>`), with the migration moving deeper Runs and rewriting declarations. That needs its own migration guide and is out of scope here.

4. **Bare-root callers take the bound as an option.** `scanProjectRoot`, `RunTargetIndex.open` and `resolveRunTarget` accept `runDepth` and forward it to `discoverRuns`; `discoverRuns(project)` reads `project.runDepth`, so callers that already pass a configured `ProjectConfig` get the bound automatically. Project-relative path resolution never walks and ignores the bound.

5. **CLI flag, not CLI config.** The CLI removed config.yml support, so a global `--run-depth <1|2>` is validated once in a commander pre-action hook and exposed through a tiny module (`lib/discovery-options.ts`) that the scan, index builder and Run-target call sites spread into their options. Unset → no option → unbounded. Impact on CLI nodes: none unless an operator passes the flag; `memon update` picks up the new binary as a MINOR release.

6. **Direct-path phantom classification as an opt-in input.** `computeMembership` stays synchronous and gains `declaredRuns?: ReadonlyMap<string, Run | null>`: when supplied, every project-relative reference is looked up there (null → `PHANTOM_RUN_REF`), never in the walked list; base-name references still use the walked list. A new async `resolveDeclaredRuns({ projectRoot, project, experiments, runs })` builds that map: for each distinct declared path it runs the existing containment check (`resolveDeclaredRunPath`: realpath containment, directory check), reuses a walked Run record with the same path, or reads the directory with `readRunDir` (README-less → `hasReadme: false`); any failure maps to null. `computeMembershipFromDisk(input)` composes both. Without `declaredRuns` the old behaviour is kept, so backend/Web output does not change until they opt in; cost is one stat/realpath set per declared path, independent of project size.
   - Alternative: stat inside `computeMembership` (rejected: it would become async and break both existing synchronous callers owned by the concurrent change).

## Risks / Trade-offs

- [A Project sets `run_depth` too low and loses Runs from the list] → Declared members are still resolved by path and not reported as phantoms; only undeclared deep Runs disappear from the walk. Documented as the operator's choice.
- [Backend/Web keep the walk-based phantom rule until they adopt the helper] → Integration points listed in the apply report; the behaviour is unchanged rather than half-changed.
- [Direct-path reads add I/O to anomaly computation] → Bounded by the number of declared paths and only paid by callers that opt in.

## Migration Plan

No data migration. Releasing is a MINOR bump (core + CLI). Rollback is reverting the commits; a config carrying `run_depth` is ignored by older versions (the Project schema strips unknown keys).
