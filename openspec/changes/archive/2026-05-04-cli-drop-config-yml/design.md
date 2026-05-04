## Context

`@memon/cli` currently threads a `configPath?: string` through every subcommand, and `loadCliContext` (in `@memon/core`) has a 4-way precedence (`projectRoot` → `configPath` → `cwd/config.yml` → implicit cwd). In practice, only two paths matter: skills and humans pass `--project-root`, or they `cd` into a project and rely on implicit cwd. The remaining two paths (`--config` and cwd `config.yml`) are vestigial, leftover from an early plan where the CLI would orchestrate multi-project queries directly. That role moved to the web stack (`memon serve` → Next.js → `apps/web/lib/runtime.ts`) and the CLI never grew a real use case for `--config`.

Removing those two paths is a clean win: smaller surface, less plumbing, single resolution rule for skills to reason about. `memon serve` is the only subcommand that legitimately needs to point at a config file, and it does so today via the global flag — we move it to a serve-specific option so the global namespace is clean.

## Goals / Non-Goals

**Goals:**
1. CLI subcommands (everything except `serve`) accept only `--project-root <path>` for project resolution; default to cwd when absent.
2. `--config <path>` exists only on `memon serve`.
3. `loadCliContext` shrinks to two branches and drops `configPath` from its input type.
4. Web app's config loading is unaffected.
5. The README and CLI `--help` no longer mention `--config` outside `serve`.

**Non-Goals:**
1. Removing `loadConfig` / `ConfigError` from `@memon/core` (web still needs them).
2. Changing where `config.yml` lives or how the web stack discovers it.
3. Backward compatibility shim that quietly accepts `--config` and ignores it. The user is the only consumer; clean break is preferable to silent pretend-it-works.
4. Auto-walking up from cwd to find a project root (the implicit-cwd path remains "the directory you ran the command from is the project").

## Decisions

### D1. Hard removal, no deprecation window

- **Choice**: drop `--config` globally and at every subcommand entry point in one cut. commander will reject `memon list --config foo.yml` with `error: unknown option '--config'` (its built-in behavior).
- **Reason**: single user, single repo, no published binary; the cost of a deprecation cycle (warning logs, dual code paths) is much higher than a one-time grep + fix. Skills don't use it. `git log` shows no recent traffic on those code paths.
- **Trade-off**: any in-the-wild script that passes `--config` to a non-serve subcommand breaks loudly. Acceptable.

### D2. `memon serve` keeps its own `--config`

- **Choice**: move the option from `program.option(...)` to `serve.option(...)`. Same flag name, same behavior, narrower scope.
- **Reason**: `serve` is structurally different — it spawns the Next.js process and only needs to compute `MEMON_CONFIG_PATH`. It's not querying experiments itself, so it doesn't need `loadCliContext`. Keeping the flag here preserves the already-tested config resolution in `serve.ts` (cwd or repo-root fallback).
- **Alternative considered**: drop `serve --config` too and force `MEMON_CONFIG_PATH` env var. Rejected: the env-var route is fine for the web app's own dev loop, but `memon serve` is a wrapper for humans, and a `--config` flag is a normal expectation.

### D3. `loadCliContext` shrinks but stays

- **Choice**: keep the function name and its `LoadCliContextResult` shape (so call sites keep their structure). Drop `configPath` from the input; drop `'explicit-config'` and `'cwd-config'` from the `source` union; the body becomes a simple `projectRoot ? singleProject(...) : implicitCwdProject(...)`.
- **Reason**: the function's *role* — give a CLI invocation a `Config` object — is still useful. Simplification is internal; call sites only stop passing `configPath` and stop matching on the deleted source values (none currently do that anyway).
- **Alternative considered**: delete `loadCliContext` entirely and have callers build the `Config` inline. Rejected: the centralization is genuinely useful, and `'project-root'` vs `'implicit-cwd'` source distinction is still meaningful for telemetry / future features.

### D4. `loadConfig` stays in `@memon/core`

- **Choice**: leave the loader untouched in `packages/core/src/config/load.ts`. It's still imported by `apps/web/lib/runtime.ts` and `packages/cli/src/commands/serve.ts` (transitively, via the `MEMON_CONFIG_PATH` env var the web reads).
- **Reason**: the loader itself is fine — schema parsing, project root resolution, auth handling. Only the *CLI's reliance on it for non-serve commands* is what's being removed.

### D5. Implicit cwd remains the default

- **Choice**: when no `--project-root` is given to a non-serve subcommand, treat `process.cwd()` as the single project root. This is the same as `implicitCwdProject(cwd)` today.
- **Reason**: ergonomic. Running `memon list` from inside a project directory should "just work". The skill convention (`--project-root .`) is more explicit but functionally equivalent when cwd matches.
- **Trade-off**: a user running `memon list` from the repo root will see "the repo as one project", which probably isn't what they want — but this matches today's behavior, and the failure mode (empty list / weird scan) is loud, not silent.

### D6. Help text and error messages

- **Choice**: commander's `--help` auto-regenerates. The README's "Usage" section needs a manual update to drop `--config` mentions for non-serve commands. The error message in `serve.ts` for "no config found" stays as-is. The README's "First run" / `apps/web/app/page.tsx` first-run prose may also need a small touch — it currently says "edit `config.yml`" which is still accurate; only places that say "use `--config` with `memon list`" need fixing.

## Risks / Trade-offs

- **[BREAKING for any script using `memon <subcommand> --config X`]** → **Mitigation**: this is the entire point of the change; the scripts must move to `--project-root`. There are no such scripts in this repo (grep confirms).
- **[`memon list` from repo root behaves oddly]** → **Mitigation**: same as today — implicit-cwd treats the repo root as a project, scanning a huge tree. Document in README that for multi-project setups you need `memon serve` (web) for now. CLI is single-project by design after this change.
- **[Future "CLI handles multi-project" requirement]** → **Mitigation**: re-introduce `--config` later if the use case actually appears. The change keeps `loadConfig` in core, so adding it back would be a small additive change, not a redesign.

## Migration Plan

No data migration. Code change deploys atomically with the spec update. The `config.yml` file itself stays unchanged on disk (`memon serve` and the web app still read it).

If a user has a script like:
```
memon list --config /path/to/config.yml --project foo
```
They migrate to:
```
memon list --project-root /path/to/foo-project-dir
```
or simply `cd` into that directory and run `memon list`.

## Open Questions

None.
