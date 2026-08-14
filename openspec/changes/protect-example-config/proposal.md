## Why

The web runtime has a last-resort configuration fallback that selects the
committed `config.example.yml` when no instance `config.yml` exists. Startup
authentication initialization then persists generated credentials and session
secrets into whichever path the runtime selected. As a result, a production
build or a direct Next.js startup can unexpectedly modify the committed example
file even though `memon serve` already documents `config.yml` as the required
runtime configuration.

`config.example.yml` is source-controlled documentation: an Agent or human
maintainer may intentionally update it when the configuration schema changes,
but application code must never use it as a persistence target. Runtime state
belongs only in an operator-created instance configuration.

## What Changes

- Define `config.example.yml` as a protected, template-only file. Application
  runtime paths may neither select it as an active configuration nor write,
  replace, or append generated state to it.
- Remove the web runtime's implicit `config.example.yml` fallback. With no
  `MEMON_CONFIG_PATH` and no repository `config.yml`, configuration resolution
  fails with guidance to create an instance file instead of silently loading
  the example.
- Reject an explicit `MEMON_CONFIG_PATH` or `memon serve --config` value whose
  final path component is `config.example.yml`, with a message directing the
  operator to copy it to an instance path such as `config.yml`.
- Add a defense at the authentication persistence boundary so even a caller
  that bypasses normal path resolution cannot initialize credentials or a
  session secret in `config.example.yml`.
- Preserve first-run password and session-secret persistence for valid instance
  configurations, including explicitly selected files whose names are not
  `config.yml`.
- Document the ownership distinction: Agents/humans maintain the committed
  example; the runtime may persist generated values only to an instance config.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `auth-system`: protects `config.example.yml` from every runtime mutation while
  retaining first-run initialization for instance configurations.
- `memon-cli`: rejects the example template as a `memon serve` configuration
  source and continues to require an instance config.

## Impact

- `apps/web/lib/runtime.ts` and configuration-path helpers: remove the example
  fallback and reject an explicitly selected protected template.
- `apps/web/lib/auth/first-run.ts`: enforce the protected-template invariant at
  the final configuration write boundary.
- `packages/cli/src/commands/serve.ts`: reject
  `--config .../config.example.yml` before spawning Next.js.
- Focused web/auth and CLI tests: prove implicit resolution, explicit
  selection, production build/startup, and direct persistence calls leave the
  example byte-for-byte unchanged while instance initialization still works.
- `README.md` and `config.example.yml` comments: state that the example is
  maintained by Agents/humans and must be copied to an instance file before
  serving.
- No configuration schema change, dependency addition, FS convention bump, or
  data migration.
