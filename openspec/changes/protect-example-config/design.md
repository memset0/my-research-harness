## Context

There are currently two configuration entry paths for the web application:

1. `memon serve` resolves an explicit `--config`, then `<cwd>/config.yml`, then
   `<repo-root>/config.yml`, and passes the selected absolute path through
   `MEMON_CONFIG_PATH`.
2. A directly invoked Next.js build/dev/start process resolves
   `MEMON_CONFIG_PATH` when present and otherwise walks to the workspace root.
   That second path currently tries both `config.yml` and
   `config.example.yml`.

The authentication first-run path receives only the selected path. When
`auth.password` or `auth.session_secret` is missing, it atomically rewrites that
path. It cannot distinguish an operator instance from the committed template,
so the direct-web fallback turns a read fallback into a source-tree mutation.

The canonical CLI specification already says that `memon serve` does not fall
back to `config.example.yml`. This change aligns the direct web runtime with
that contract and adds defense in depth for explicit or future callers.

## Goals / Non-Goals

**Goals:**

- Make it impossible for application runtime code to mutate the repository's
  `config.example.yml` through supported configuration and authentication
  initialization paths.
- Keep `config.example.yml` available as source-controlled documentation that
  Agents and humans intentionally maintain.
- Require a deliberate instance configuration before the dashboard runtime can
  initialize generated credentials.
- Preserve automatic password and session-secret persistence for legitimate
  instance files, including custom paths selected with `--config` or
  `MEMON_CONFIG_PATH`.
- Produce actionable errors that explain how to copy the template to an
  instance file.

**Non-Goals:**

- Removing first-run credential generation or changing the plaintext-on-host
  authentication threat model.
- Automatically copying `config.example.yml` to `config.yml`; creating the
  operator-owned instance remains an Agent/human action.
- Making `config.yml` source-controlled or changing `.gitignore` policy.
- Changing the YAML schema, authentication values, project configuration, or FS
  convention version.
- Preventing an Agent or human source edit that intentionally updates the
  example template.
- Protecting arbitrary files named `example.yml`; the reserved repository
  template name is exactly `config.example.yml`.

## Decisions

### D1. The example template is not a runtime configuration source

The direct web resolver will use `MEMON_CONFIG_PATH` when it names a valid
instance configuration, otherwise it will search only for `config.yml` at the
workspace root. It will no longer read `config.example.yml` as a last-resort
runtime configuration.

If no instance exists, the runtime reports that configuration is unavailable
and tells the operator to copy `config.example.yml` to `config.yml` (or set
`MEMON_CONFIG_PATH` to another instance). It does not create a file or attempt
authentication initialization. This makes an accidental build from a fresh
checkout read-only with respect to both configuration paths.

**Alternative considered:** continue reading the example but suppress only the
authentication write. Rejected because the server would then run with a
template that is documented as incomplete, while generated credentials would
have no durable source of truth. It also leaves future runtime persistence
features exposed to the same mistake.

### D2. Exact reserved-name rejection applies to implicit and explicit entry paths

A normalized path whose final component is exactly `config.example.yml` is a
protected template. Both direct-web `MEMON_CONFIG_PATH` resolution and
`memon serve --config` reject it before loading or spawning the application.
Other explicit filenames remain valid instance configurations; for example,
`/etc/memon/cluster.yml` may receive first-run values.

The policy is based on the reserved final component rather than one hard-coded
repository absolute path. This protects copied checkouts and alternate
worktrees consistently and prevents an explicitly supplied example path from
bypassing the default-resolution fix.

### D3. Authentication persistence independently enforces the invariant

Path resolution is the first line of defense, but the atomic authentication
writer will also reject a protected template path before `stat`, temporary-file
creation, write, or rename. This guard applies when generating an entire
`auth:` block and when appending only `session_secret`.

Keeping the guard at the persistence boundary protects direct unit/library
callers and future resolver refactors. The failure must identify the protected
path and direct the operator to create an instance file. No
`config.example.yml.tmp` residue may be created.

### D4. A shared path predicate prevents CLI/web policy drift

The implementation should expose one small server-side path-policy helper from
`@memon/core` (or an equivalently shared module) that recognizes the exact
reserved filename. The CLI, web resolver, and authentication write guard use
that policy while retaining surface-specific error formatting.

This helper classifies paths only; it does not read or write the filesystem and
does not turn general configuration loading into a mutating operation.

### D5. Template maintenance remains an intentional source-authoring action

The runtime restriction does not make the file immutable at the filesystem or
Git layer. Agents and human maintainers continue to update
`config.example.yml` when adding documented configuration fields or fixtures.
The distinction is ownership and execution context: source-authoring changes
may edit the example deliberately; server/build/CLI runtime code may not.

## Risks / Trade-offs

- Developers who previously relied on `pnpm --filter @memon/web dev` loading
  the example automatically must create `config.yml` first. The existing
  README already teaches that copy step; clearer errors and comments make the
  transition explicit.
- Reserved-name matching does not protect an arbitrary differently named copy
  of the template. That is intentional: once an operator chooses another name
  and explicitly selects it, it is an instance configuration and may receive
  generated runtime values.
- A path-policy check at more than one entry point can drift. A shared predicate
  plus focused tests at each surface mitigates this.
- A production build may evaluate server modules even though it does not serve
  requests. The no-instance test must therefore validate both successful build
  behavior and unchanged example bytes/mtime, not assume that build-time code
  is inert.

## Migration Plan

No data migration is needed. Existing deployments already using `config.yml`
or an explicitly selected non-example instance continue unchanged.

A developer who intentionally used `config.example.yml` as the live config
must copy it to `config.yml` (or another filename) and select that instance.
Rollback would restore the implicit fallback and explicit acceptance, but doing
so would reintroduce the source-tree mutation defect; no on-disk conversion is
required in either direction.
