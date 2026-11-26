# Spec Delta

## MODIFIED Requirements

### Requirement: Single-user credentials live in `config.yml` under top-level `auth` block (PLAINTEXT)

The config schema SHALL accept an optional top-level `auth` mapping with keys `username` (string, default `"admin"`) and `password` (string, **plaintext**). When `auth` is missing or `password` is missing/empty, the server SHALL treat the configuration as "uninitialised" and trigger first-run password generation (see "First-run password generation"). CLI commands that do NOT start the HTTP server (e.g. `memon list`, `memon serve --help`) SHALL NOT require `auth` to be present.

These credentials belong to account #1, the single `super_admin` (see the `user-accounts` capability). Further accounts live in the central account store with scrypt-hashed passwords; `config.yml` never holds them.

Plaintext on disk is intentional. The threat model is "single user, host filesystem trust = HTTP auth trust" (same boundary as `~/.ssh/id_*`). Storing plaintext in `config.yml` means dev agents and curl-based automation can read the password from a single canonical source; a hashed-on-disk + scrypt-verify path would add latency and tooling friction without changing the threat model meaningfully.

#### Scenario: Config has a complete auth block
- **WHEN** `config.yml` contains `auth: { username: "alice", password: "secret123" }`
- **THEN** `loadConfig` returns a `Config` whose `auth` field equals `{ username: "alice", password: "secret123" }`
- **AND** the HTTP server starts without modifying `config.yml`

#### Scenario: Config has no auth block
- **WHEN** `config.yml` has no top-level `auth` key
- **THEN** `loadConfig` returns `auth: undefined`
- **AND** the HTTP server's startup path triggers first-run password generation (see separate requirement)

#### Scenario: Config has malformed auth block
- **WHEN** `config.yml` has `auth: { password: 123 }` (wrong type) OR `auth: { password: "" }` (empty)
- **THEN** `loadConfig` throws `ConfigError` with a message identifying `auth.password`
- **AND** the HTTP server refuses to start

#### Scenario: Config owner is account #1
- **WHEN** `config.yml` contains `auth: { username: "alice", password: "secret123" }` and stored accounts exist
- **THEN** `alice` authenticates as account #1 with level `super_admin`
- **AND** no stored account can use the username `alice`
