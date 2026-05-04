## Why

The `memon` CLI's `config.yml` support is dead weight for everything except `memon serve`. The original design intent — captured in `packages/core/src/cli/context.ts:5` — already says "Skill design intent: pass --project-root and ignore everything else." Skills do exactly that; nothing in `packages/skills/` or any in-repo caller reaches for `--config`. The only meaningful consumer of `config.yml` is the web stack (`memon serve` → Next.js app → `apps/web/lib/runtime.ts`), which already locates the file independently by walking up to the repo root.

The cost of keeping the CLI config-aware:
- Every subcommand has a `configPath?: string` plumbing layer (10+ files in `packages/cli/src/commands/`).
- `loadCliContext` has 4 branches (`projectRoot` | `configPath` | `cwd-config` | `implicit-cwd`); one of them is the "real" path skills use, the other three exist for an option matrix nobody hits.
- The CLI surface advertises `--config <path>`, which invites users to wire CLI invocations through `config.yml` and creates ambiguity about which projects a given subcommand "sees".

Drop config-loading from the CLI. `--project-root <path>` (explicit) or implicit cwd (default) becomes the only path. `memon serve` keeps its `--config` flag because it spawns the web stack which legitimately needs the multi-project / poll / auth schema.

## What Changes

1. **BREAKING** Remove the global `--config <path>` flag from `memon`. The flag SHALL only be accepted on `memon serve` (where it's already a different beast — it just sets `MEMON_CONFIG_PATH` for the web stack).
2. **BREAKING** Remove the `<cwd>/config.yml` implicit fallback for non-`serve` subcommands. With this change, the resolution order for non-`serve` subcommands becomes:
   1. `--project-root <path>` (explicit)
   2. cwd treated as a single anonymous project (implicit, unchanged)

   The third and fourth branches that existed before — explicit `--config` and `<cwd>/config.yml` — go away entirely for non-serve.
3. **Simplify** `loadCliContext` in `@memon/core` to a 2-branch resolver (`projectRoot` | `implicit-cwd`); drop `configPath` from its input type and remove the `cwd-config` / `explicit-config` source values.
4. **Simplify** `packages/cli/src/lib/context.ts`'s `resolveContext` and the `CliFlags` shape to drop `configPath`.
5. **Strip plumbing**: remove `configPath?: string` from every command's options interface and call site in `packages/cli/src/commands/*.ts`.
6. **Keep `memon serve` config-aware**: move `--config <path>` from the global option to a `serve`-specific option. Behavior unchanged: it resolves a config file (cwd or repo root) and exports `MEMON_CONFIG_PATH` to the spawned web process.
7. **Keep `loadConfig` in `@memon/core`** — it's still used by the web stack (`apps/web/lib/runtime.ts`) and by `memon serve` to validate before spawning. Only the CLI-facing wrapper is simplified.
8. **Migration note in README / spec**: any user with a habit of running `memon list --config foo.yml` SHALL switch to `memon list --project-root <path>` (or `cd` into the project directory). Help text on the `memon` root command SHALL not mention `--config` anymore.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `memon-cli`: The "Config resolution order" requirement is rewritten — global `--config` is gone, the CLI-side `cwd/config.yml` fallback is gone, and the precedence order shrinks to `--project-root` then implicit cwd. The "memon serve" requirement is updated to specify that `--config` is now serve-specific (not global). Scenarios for the dropped paths are removed; new scenarios cover the simpler precedence and the BAD_REQUEST path when an old user still passes `--config` to a non-serve subcommand (commander will reject it with "unknown option").

## Impact

- **Code**:
  - `packages/cli/src/index.ts`: drop global `--config`; add `--config <path>` as a `serve`-specific option; remove `configPath` from `Globals`; update `readGlobals` accordingly.
  - `packages/cli/src/lib/context.ts`: drop `configPath` field from `CliFlags`; the mutual-exclusion check against `configPath` goes away.
  - `packages/cli/src/commands/*.ts` (list / show / search / hypo / journal / experiment / scan): drop `configPath` from the per-command options interface; stop forwarding it to `resolveContext`.
  - `packages/core/src/cli/context.ts`: simplify `loadCliContext` to a 2-branch resolver; drop `configPath` from `LoadCliContextInput`; remove `'explicit-config'` and `'cwd-config'` from `source` union.
  - `packages/core/src/cli/context.test.ts`: drop test cases for the removed branches; add a case ensuring `configPath` is no longer accepted in the input type (compile-time).
  - `packages/cli/src/commands/serve.ts`: unchanged signature (`opts.configPath` still flows in, just from the serve-specific option now).
  - **Untouched**: `packages/core/src/config/load.ts` (still used by web + serve); `apps/web/lib/runtime.ts` (already independent); `apps/web/lib/auth/first-run.ts`; `loadConfig` re-export from `@memon/core`.
- **Tests**: existing core/cli tests for `--config` and cwd-config branches must be deleted (not "updated") — those code paths cease to exist. Tests covering `--project-root` and implicit-cwd remain as-is. Integration tests that ran `memon list --config foo.yml` (if any) need rewriting to use `--project-root`.
- **Skills**: zero impact. Grep of `packages/skills/` shows no `--config` usage.
- **Docs**: `README.md` and any `apps/web/app/page.tsx` first-run prose that mentions `--config` for the CLI (not `memon serve`) needs updating; help text in commander auto-updates from the source.
- **`config.yml` file itself**: no change — it still lives at the repo root, still gitignored, still consumed by the web stack and `memon serve`.
