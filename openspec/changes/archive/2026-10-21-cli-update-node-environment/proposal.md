## Why

`memon update` fails on CLI nodes that differ from a full development checkout. A node that never ran a full workspace build has no `@memon/skills` build output, so the CLI build cannot resolve its types and every update rolls back. A node that keeps pnpm's store, cache and state out of a shared HOME through `npm_config_*` variables loses that redirection, because the updater strips every `npm_*` variable from its child processes; pnpm then targets the default shared store, sees a store mismatch and aborts without a TTY.

## What Changes

- The update build builds the `@memon/skills` package output before the CLI, without the repository-maintenance checks that need development-only tools absent from the CLI dependency closure. Its previous output is backed up and restored by rollback like the other built packages.
- Operator-set npm/pnpm configuration in the environment (`npm_config_*`) reaches the nested install and build commands when `memon update` runs directly. Package-script lifecycle variables are still removed, and a run launched from a package script still drops inherited `npm_config_*`, so a parent package-manager run cannot redirect the nested one.

## Capabilities

### New Capabilities

### Modified Capabilities
- `memon-cli`: the "Memon update pulls and installs latest CLI and skills" requirement gains scenarios for a node without prior skills build output and for operator package-manager configuration carried in the environment.

## Impact

- `packages/cli/src/commands/update.ts` (build sequence, backed-up build outputs, child environment) and its tests.
- `packages/skills/package.json` gains a build entry that produces only the package output.
- Distributed CLI artifact: MINOR release; nodes pick it up through `memon update`. A node already failing this way needs one manual skills build (or a fresh checkout of the fixed release) to get past its current CLI.
