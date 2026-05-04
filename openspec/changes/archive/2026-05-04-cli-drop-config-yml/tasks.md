## 1. Core: simplify `loadCliContext`

- [x] 1.1 `packages/core/src/cli/context.ts`:
  - Drop `configPath?: string` from `LoadCliContextInput`
  - Remove the `'explicit-config'` and `'cwd-config'` literals from the `source` union; new union: `'project-root' | 'implicit-cwd'`
  - Simplify the function body to: if `projectRoot` → single anonymous project; else → `implicitCwdProject(cwd)`
  - Remove the `--project-root cannot be combined with --config` BAD_REQUEST branch (no longer reachable)
  - Update the JSDoc / file-top comment to describe the 2-branch precedence
- [x] 1.2 `packages/core/src/cli/context.test.ts`: delete tests for `cwd-config` and `explicit-config` source paths and the configPath × projectRoot mutual-exclusion case; add a test confirming the input type rejects `configPath` (compile-time via `@ts-expect-error`) and that the source enum is restricted

## 2. CLI: remove global `--config`

- [x] 2.1 `packages/cli/src/index.ts`:
  - Remove `.option('--config <path>', ...)` from the global `program` chain
  - Remove `configPath?: string` from the `Globals` interface
  - Remove the `opts.projectRoot && opts.config` mutual-exclusion check in `readGlobals`
  - Remove `configPath: opts.config` from the `Globals` literal
- [x] 2.2 `packages/cli/src/index.ts` `serve` subcommand: add `.option('--config <path>', 'path to config.yml (defaults to <cwd>/config.yml then <repo-root>/config.yml)')` to the `serve` command itself; read it via the action's local `opts` (not from `readGlobals`); pass it to `runServe({ configPath: opts.config, ... })`
- [x] 2.3 Update help-text strings if any subcommand description mentions `--config`

## 3. CLI: strip `configPath` plumbing from non-serve commands

- [x] 3.1 `packages/cli/src/lib/context.ts`: drop `configPath` field from `CliFlags`; drop the `flags.projectRoot && (flags.configPath || flags.project)` branch (replace with just `flags.projectRoot && flags.project`); stop forwarding `configPath` to `loadCliContext`
- [x] 3.2 `packages/cli/src/commands/list.ts`: remove `configPath?: string` from the options interface and from the call to `resolveContext`
- [x] 3.3 `packages/cli/src/commands/show.ts`: same
- [x] 3.4 `packages/cli/src/commands/search.ts`: same
- [x] 3.5 `packages/cli/src/commands/hypo.ts`: same (both `runHypoList` and `runHypoShow`)
- [x] 3.6 `packages/cli/src/commands/journal.ts`: same (read / append / digest-mark)
- [x] 3.7 `packages/cli/src/commands/experiment.ts`: same (status set / readme write / archive / unarchive)
- [x] 3.8 `packages/cli/src/commands/hypotheses.ts`: same (if it has configPath)
- [x] 3.9 `packages/cli/src/commands/doctor.ts`, `scan.ts`, `mock.ts`, `install-skills.ts`: audit for `configPath` and remove
- [x] 3.10 Re-grep `packages/cli/src` for `configPath` after edits — should only match in `serve.ts` (which keeps it for its own flag)

## 4. Tests: drop dead test cases, keep `--project-root` and implicit-cwd tests

- [x] 4.1 `packages/core/src/cli/context.test.ts`: delete cases for `cwd-config`, `explicit-config`, and the configPath × projectRoot mutual exclusion; verify remaining cases (project-root happy path, project-root not-found, project-root not-a-dir, implicit-cwd) still pass
- [x] 4.2 `packages/core/src/config/load.test.ts`: leave alone — `loadConfig` is unchanged and still used by web/serve
- [x] 4.3 `packages/cli/test/*` (or similar): if any test invokes `memon ... --config X` for a non-serve subcommand, rewrite to use `--project-root` (currently none in repo per grep, but verify after refactor)
- [x] 4.4 Add a new test in `packages/core/src/cli/context.test.ts` (or a new file) confirming:
  - `loadCliContext({ projectRoot: '<existing>', cwd })` returns `source: 'project-root'`
  - `loadCliContext({ cwd })` returns `source: 'implicit-cwd'` with a single project rooted at `cwd`

## 5. Docs

- [x] 5.1 `README.md`: scan for any `--config` mentions tied to non-serve commands; remove or rewrite to `--project-root`
- [x] 5.2 `README.md` "Browser terminal" / "Auth" / general usage sections: leave references to `config.yml` as a *file* alone; only `--config` *flag* mentions for non-serve need updating
- [x] 5.3 `apps/web/app/page.tsx` first-run prose: re-read; if it points users at "use `memon --config` to ..." for any non-serve command, update; references to editing `config.yml` itself stay as-is
- [x] 5.4 `CLAUDE.md` "Dev: HTTP API auth" section is unchanged (it just reads `config.yml` as a file, doesn't mention the `--config` flag)

## 6. Verification

- [x] 6.1 `pnpm typecheck` (root) — clean
- [x] 6.2 `pnpm test` (root) — all tests pass
- [x] 6.3 `openspec validate cli-drop-config-yml --type change --strict` — clean
- [x] 6.4 Manual smoke:
  - `memon list --project-root mock/project-a` → returns experiments JSON, exit 0
  - `cd mock/project-a && memon list` → same result via implicit-cwd
  - `memon list --config /tmp/x.yml` → commander rejects with "unknown option"
  - `memon serve --config config.yml --dev` → spawns the web stack with `MEMON_CONFIG_PATH=<absolute>`
  - `memon serve` (no `--config`, from repo root with config.yml present) → still works (resolves to `<cwd>/config.yml`)
  - `memon --config config.yml serve` → commander rejects (global option removed)
- [x] 6.5 Grep `packages/cli/src` for `--config`: should match only inside `commands/serve.ts` and `index.ts` (the serve subcommand option line)
- [x] 6.6 Grep `packages/core/src` for `configPath`: should NOT match inside `cli/context.ts`; SHALL still match inside `config/load.ts` (which is web/serve only)
