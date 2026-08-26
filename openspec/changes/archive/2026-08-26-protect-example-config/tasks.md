## 1. Shared configuration path policy

- [x] 1.1 Add a side-effect-free shared path-policy helper that recognizes a
  normalized path whose exact final component is `config.example.yml` as the
  protected example template, and export it for server-side web and CLI use.
- [x] 1.2 Add focused unit tests for the exact reserved filename, absolute and
  relative paths, custom instance filenames, and near-miss names that must
  remain valid.

## 2. Web runtime resolution

- [x] 2.1 Refactor the web configuration resolver so an absent
  `MEMON_CONFIG_PATH` searches only for workspace `config.yml` and never falls
  back to `config.example.yml`.
- [x] 2.2 Reject an explicit `MEMON_CONFIG_PATH` that names the protected
  example before calling `loadConfig`, with an actionable copy-to-instance
  error; preserve explicit non-example paths.
- [x] 2.3 Add resolver tests covering: instance config selected, only example
  present, neither present, explicit example rejected, and explicit custom
  instance selected without mutation.

## 3. Authentication persistence defense

- [x] 3.1 Enforce the protected-template check inside
  `ensureAuthInitialised` (and at the common atomic write boundary where
  practical) before any stat, temporary-file creation, write, or rename.
- [x] 3.2 Add first-run tests for both mutation branches—new `auth` block and
  missing `session_secret`—proving a direct protected-path call fails, leaves
  bytes and mtime unchanged, and creates no temporary sibling.
- [x] 3.3 Retain and extend positive coverage proving `config.yml` and an
  explicitly selected custom instance such as `cluster.yml` still receive the
  generated values atomically and idempotently.

## 4. CLI serve enforcement

- [x] 4.1 Make `memon serve --config` reject the protected example before the
  child process is spawned, using the shared path policy and the CLI's
  structured error envelope.
- [x] 4.2 Add CLI tests proving an explicit example is rejected without spawn,
  an explicit custom instance exports the expected absolute
  `MEMON_CONFIG_PATH`, and default resolution with only the example reports the
  existing missing-instance guidance.

## 5. Documentation and regression coverage

- [x] 5.1 Update `README.md` and the header comments in
  `config.example.yml` to state that Agents/humans maintain the example, runtime
  code never writes it, and operators must copy it to `config.yml` or select a
  differently named instance before serving.
- [x] 5.2 Add an isolated-process direct-web runtime regression using a fixture
  workspace that contains only `config.example.yml`; verify no credentials or
  temporary file appears and the template content and mtime remain unchanged.
- [x] 5.3 Run the production web build with no instance config selected and
  compare `config.example.yml` bytes and mtime before/after; use an explicit
  temporary instance for subsequent served-runtime verification.

## 6. Verification

- [x] 6.1 Run focused shared path-policy, web runtime resolver,
  authentication first-run, and CLI serve tests.
- [x] 6.2 Run `pnpm --filter @memon/core typecheck`,
  `pnpm --filter @memon/cli typecheck`, and
  `pnpm --filter @memon/web typecheck`.
- [x] 6.3 Build the affected packages and the production web application, then
  verify both the protected-template failure and valid-instance startup paths.
- [x] 6.4 Strictly validate this OpenSpec change.
