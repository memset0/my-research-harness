## ADDED Requirements

### Requirement: Example configuration is template-only and runtime-immutable

The source-controlled file whose final path component is exactly
`config.example.yml` SHALL be treated as a documentation template maintained
only through intentional Agent or human source-authoring changes. Application
runtime code, including Next.js build/dev/start, web runtime initialization,
and authentication first-run initialization, SHALL NOT select that file as the
active runtime configuration and SHALL NOT write, append, truncate, replace, or
atomically rename content over it.

When `MEMON_CONFIG_PATH` is absent, direct web configuration resolution SHALL
search for the workspace instance `config.yml` only and SHALL NOT fall back to
`config.example.yml`. When `MEMON_CONFIG_PATH` explicitly resolves to a path
whose final component is `config.example.yml`, initialization SHALL fail before
configuration loading or persistence with an actionable message directing the
operator to copy the template to an instance file.

The authentication persistence boundary SHALL independently reject a protected
example path before any filesystem mutation, even if a caller bypasses normal
configuration resolution. In the existing first-run password and HMAC-key
requirements, references to writable `config.yml` mean an accepted instance
configuration path; an explicitly selected non-example filename is also an
instance and remains eligible for runtime persistence.

#### Scenario: Fresh checkout has only the example template

- **GIVEN** a workspace contains `config.example.yml` but no `config.yml`
- **AND** `MEMON_CONFIG_PATH` is unset
- **WHEN** the direct web runtime resolves configuration during build, dev, or start
- **THEN** it reports that no instance configuration is available and explains
  how to create or select one
- **AND** it does not load `config.example.yml` as the active configuration
- **AND** `config.example.yml` remains byte-for-byte unchanged with the same mtime

#### Scenario: Environment explicitly selects the protected template

- **GIVEN** `MEMON_CONFIG_PATH=/workspace/config.example.yml`
- **WHEN** the web runtime initializes
- **THEN** initialization fails with an error naming the protected example and
  directing the operator to an instance config
- **AND** authentication initialization is not invoked
- **AND** neither `config.example.yml` nor a temporary sibling is modified or created

#### Scenario: Persistence guard rejects a bypassing caller

- **GIVEN** a caller directly invokes authentication first-run initialization
  with `/workspace/config.example.yml`
- **WHEN** either a missing `auth` block or missing `auth.session_secret` would
  otherwise require persistence
- **THEN** the call fails before any stat/write/rename mutation sequence
- **AND** the example's bytes and mtime remain unchanged
- **AND** no `config.example.yml.tmp` file remains

#### Scenario: Custom-named instance remains writable

- **GIVEN** `MEMON_CONFIG_PATH=/etc/memon/cluster.yml`
- **AND** that instance has projects but no `auth` block
- **WHEN** the web runtime performs first-run authentication initialization
- **THEN** it atomically persists the generated password and session secret to
  `cluster.yml` under the existing first-run contract
- **AND** no `config.example.yml` is read or modified

#### Scenario: Production build cannot dirty the example

- **GIVEN** the repository starts with a clean, source-controlled
  `config.example.yml` and no instance config is selected
- **WHEN** the production web build completes or reports its expected missing-
  configuration state
- **THEN** `git diff --exit-code -- config.example.yml` succeeds
- **AND** no generated authentication credential or session secret appears in
  the example
