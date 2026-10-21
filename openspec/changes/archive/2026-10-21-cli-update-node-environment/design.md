## Context

`memon update` installs the `@memon/cli...` dependency closure and then builds `@memon/file-protocol`, `@memon/core` and `@memon/cli`. The CLI imports `@memon/skills`, whose types come from `packages/skills/dist`, which the update never builds; it only exists on nodes that once ran a full build. The skills package `build` script also runs repository-maintenance checks (`wiki-kinds`, `component-docs`); the latter needs `tsx`, a root development dependency that the filtered install does not provide.

All child commands run with `childEnv()`, which removes every `npm_*` variable so that a run started through a package script is not redirected by the parent package manager's exported configuration. That also removes configuration an operator set on purpose.

## Goals / Non-Goals

**Goals:**
- A clean node builds every output the CLI build needs from the filtered install.
- Operator `npm_config_*` reaches nested pnpm when `memon update` is run directly.
- Rollback covers the skills output too.

**Non-Goals:**
- Running repository-maintenance checks on CLI nodes (they remain part of the development `build` and CI).
- Changing which dependencies the filtered install selects.

## Decisions

- **Separate output-only build entry for skills.** `packages/skills` gains `build:dist` (clean + `tsc -p tsconfig.build.json`); `build` keeps its checks and then runs the same output steps. The updater runs `pnpm --filter @memon/skills run build:dist` after core and before the CLI. Alternative considered: adding `tsx` to the CLI closure so the full `build` runs — rejected, it installs development tooling on every node to run checks whose results the node never uses.
- **Skills dist joins the backed-up outputs.** `packages/skills/dist` is added to the list of outputs copied aside before the fast-forward and restored on rollback, so a failed update returns the node to its exact prior state.
- **Lifecycle-aware environment filtering.** `npm_lifecycle_event` marks a process started by a package-manager script. Without it, `npm_config_*` variables are operator configuration and are kept; every other `npm_*` variable is still dropped. With it, all `npm_*` variables are dropped as before. `NODE_OPTIONS` is always dropped. The filter becomes a pure function of the environment so it can be tested directly. Alternative considered: an allow-list of store/cache/state keys — rejected, operators may legitimately set other pnpm keys (registry, network) and the list would drift from pnpm's configuration surface.

## Risks / Trade-offs

- [A package-manager launcher that sets `npm_config_*` but not `npm_lifecycle_event`] → such configuration would now apply; this is the same as running pnpm from that shell, which is the expected behaviour for a direct run.
- [Skills output built without the maintenance checks] → the checks only validate generated documentation in the repository and are enforced by development builds and CI before release; the node consumes the published result.

## Migration Plan

Ship as a MINOR CLI release. A node already stuck on the old updater needs its skills output built once by hand (or any manual build of the fixed revision); later updates run the new sequence.
