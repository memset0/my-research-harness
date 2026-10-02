## Why

A single Run walk over a large project spends almost all of its directory listings in output subtrees that never hold a Run where the project actually keeps its Runs (one measured walk: 27,040 listings, 99.6% of them under `outputs/`, while `logs/` yielded about 1,300 Runs in about 100 listings). The only lever today is excluding a whole entry directory, and excluding it silently turns every Experiment declaration that points into it into a `PHANTOM_RUN_REF`, because phantom detection is answered from the walk instead of from the declared path.

## What Changes

- State as a rule that Run directories never nest: the walk treats every Run-shaped directory name as a candidate Run (with or without README) and never descends into it. This is already the walk's behaviour; the change pins it with a listing-count test so it cannot regress.
- Add an optional per-Project `run_dirs` setting: a list of project-relative directory patterns (`/`-separated segments, `*` and `?` within a segment, no `**`, each starting with `logs`, `outputs` or `experiments`), e.g. `["logs/*", "outputs/*/*", "experiments/*/runs/*"]`, declaring where Run directories live. When set, discovery only expands those patterns segment by segment and never recurses; matched directories with a Run-shaped name are candidate Runs and others are ignored with a lint-level `RUN_DIR_PATTERN_NON_RUN` notice. Absent keeps the unbounded walk, so every existing project's discovery result is unchanged.
- Let callers that scan a bare project root (project scan, targeted Run resolution) pass the same patterns, and give the CLI a repeatable global `--run-dir <pattern>` flag because the CLI has no project-level configuration source.
- Classify `PHANTOM_RUN_REF` for project-relative declarations by checking the declared path on disk instead of looking it up in the walk result: an existing directory is never a phantom (a README-less one is a member whose Run record has no README); only a missing or unsafe path is. Exclusion and depth pruning no longer create phantoms. The pure in-memory classification keeps its previous behaviour when no direct-path results are supplied, so existing callers are unaffected until they opt in.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `run-discovery`: Run locations become declarable per Project with `run_dirs` patterns (default: unbounded walk); the non-nesting rule becomes an explicit requirement.
- `experiment-membership-anomalies`: `PHANTOM_RUN_REF` for path declarations is decided by direct path existence; a README-less existing directory is no longer a phantom.
- `memon-cli`: repeatable global `--run-dir` flag applied to every CLI Run walk.

## Impact

- `packages/core`: discovery walk, project config schema/loader and `ProjectConfig`, project scan and Run target resolution options, membership classification plus a direct-path resolution helper.
- `packages/cli`: global flag and its propagation to scan, list/show/search and Run target resolution.
- Central Web/backend callers keep their current behaviour; they adopt the direct-path membership helper and pass `runDirs` into project scans in a follow-up owned elsewhere.
- No filesystem convention change; no migration.
