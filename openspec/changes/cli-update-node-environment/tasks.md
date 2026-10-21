## 1. Skills package output

- [x] 1.1 Add a `build:dist` script to `packages/skills/package.json` (clean + `tsc -p tsconfig.build.json`) and make `build` run its checks followed by `build:dist`; verify `pnpm --filter @memon/skills build` and `pnpm --filter @memon/skills run build:dist` both produce `packages/skills/dist/index.d.ts`

## 2. Updater

- [x] 2.1 Build `@memon/skills` through `build:dist` after `@memon/core` and before `@memon/cli`, add `packages/skills/dist` to the backed-up outputs, and update the step detail and header comment; verify with update tests where the fixture CLI build requires the skills output
- [x] 2.2 Make the child environment filter keep `npm_config_*` unless `npm_lifecycle_event` is present, always drop other `npm_*` and `NODE_OPTIONS`; verify with unit tests for the direct-run and package-script cases

## 3. Verification

- [x] 3.1 Run `pnpm --filter @memon/cli test -- src/commands/update.test.ts`, `pnpm --filter @memon/cli typecheck` and Biome on the touched files; record the results
