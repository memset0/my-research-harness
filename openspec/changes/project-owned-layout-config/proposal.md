## Why

A Project's layout — where its Run directories live (`run_dirs`), which paths discovery skips (`exclude`) or keeps (`include`), and which subdirectory checks out which GitHub repository (`github`) — is a fact about the project repository, not about the machine that serves it. Today central `config.yml` is the only place that can hold `include`, `exclude` and `github`, and the precedence chain of `run_dirs` still puts central above the tracked `.memon/project.yml`. The result: every central instance (and every CLI node, which has no configuration at all) has to repeat the same layout, CLI walks ignore central excludes, and the operator's central file mixes deployment facts with per-repository conventions that should be reviewed and versioned with the project.

## What Changes

- **Decentralised configuration.** The central Project entry keeps deployment facts only: `name`, `root`, `host`, `storage`, `storage_group`, `persistent_cache`, `read_only`, `execution`. Layout facts — `run_dirs`, `include`, `exclude`, `github` — move to the project's tracked `.memon/project.yml`.
- **Declaration schema extension.** `.memon/project.yml` stays `schema_version: 1` and gains the optional keys `include`, `exclude` and `github`, validated with the same rules as the central keys (shared schema); `github[].path` must additionally stay inside the project root. Unknown keys remain `PROJECT_DECLARATION_INVALID`.
- **Per-key precedence with a deprecation window.** For each layout key independently: CLI `--run-dir` (only `run_dirs`) > central Project value (deprecated, still honoured) > `.memon/project.yml` > default. A central layout key logs one `CENTRAL_LAYOUT_DEPRECATED` warning per process; when it differs from the declaration the central value wins and a conflict warning is logged once. Behaviour of every existing deployment is unchanged until the operator moves the keys.
- **Core layout resolver.** `resolveProjectLayout(project)` returns the effective `runDirs`, `include`, `exclude`, `github` with per-key sources; `discoverRuns` (hence `scanProjectRoot`, `resolveRunTarget`, rebuild, verification) and the code-preview Git adapter use it, so `exclude`/`include`/`github` from the declaration take effect on central and on CLI nodes.
- **CLI.** `memon project init --from-central <config> --project <name> [--host <id>]` writes the named central Project's layout keys into the new declaration (falling back to defaults for absent keys); `memon project lint` validates the new keys, reports the effective layout with sources and, with the same `--from-central` options, reports `CENTRAL_LAYOUT_DEPRECATED` warnings (exit 0) for every central layout key, flagging conflicts.
- **Docs.** `AGENTS.md`, `README.md` and `config.example.yml` describe central configuration as project path plus deployment, layout in `.memon/project.yml`.
- **Not changed:** the FS convention (no marker change, no migration — the declaration stays optional), the `run_dirs` chain order (central above the declaration during the deprecation window), automatic writers (none), real project or central configuration files (migrating them is a release/operator step).

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `run-discovery`: the project declaration carries the layout keys `include`, `exclude`, `github`; per-key precedence with deprecated central values; discovery and code preview resolve the effective layout.
- `file-access-settings`: central Project configuration is deployment-only; central layout keys are deprecated, still honoured, and warned about.
- `memon-cli`: `memon project init --from-central`, and `memon project lint` validating the new keys and reporting `CENTRAL_LAYOUT_DEPRECATED`.

## Impact

- `packages/core`: `schemas.ts` (shared layout schema), `project-declaration/**` (schema, layout resolver, lint, central extraction), `discovery/discover.ts`, `config/load.ts` (deprecation log).
- `packages/cli`: `commands/project.ts`, `index.ts` registration and tests.
- `packages/backend/src/git-service.ts` and `apps/web/app/api/code-preview/route.ts`: resolve `github` mappings through the layout resolver (one call site each).
- Docs: `AGENTS.md`, `README.md`, `config.example.yml`.
- Release surfaces when shipped: `central`, `cli` (MINOR). No filesystem bump.
