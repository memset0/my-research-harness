## ADDED Requirements

### Requirement: `memon share` subcommand family

The CLI SHALL gain a new top-level subcommand `memon share` with three children:

- `memon share create <project> [--label <text>] [--expires <duration>] [--format human|json]`
- `memon share list [--project <P>] [--format human|json]`
- `memon share revoke <id-prefix-or-label> [--project <P>] [--force] [--format human|json]`

Behavior is fully specified in the `project-share` capability spec. This requirement establishes the CLI surface shape:

- The subcommands SHALL be registered in `packages/cli/src/commands/share.ts` and exposed from the main `memon` binary via the standard subcommand dispatch in `packages/cli/src/index.ts`.
- Like every other `memon` subcommand, the default output format SHALL be `json`. `--format human` switches to a human-readable table (`memon share list`) or terse status line (`memon share create` / `memon share revoke`).
- The subcommands SHALL exit non-zero on error and print a short message to stderr. Standard exit codes from the existing CLI surface apply: `0` success, `1` runtime error, `2` usage error.
- The subcommands SHALL resolve `<projectRoot>` from `cfg.projects` (via the standard config loader) — there is no `--project-root` shortcut for `memon share`, the project name is the canonical key.
- The CLI SHALL accept a `--duration` syntax of `<int>d`, `<int>h`, or `never` for `--expires`. Invalid duration strings fail usage validation (exit code 2).
- `memon share create` SHALL print the constructed share URL on stdout in human mode and include it in the JSON record in JSON mode (key `share_url`).
- The `token` field SHALL be OMITTED from `memon share list` output (both human and JSON) to avoid leaking when piped to logs. `memon share create` returns the freshly-generated token in its output because that is the one moment when the owner needs to copy it. `memon share revoke` does NOT return the token of the revoked record.

#### Scenario: `memon share create` JSON output
- **WHEN** an owner runs `memon share create project-a --label Alice` (JSON default)
- **THEN** stdout is a JSON object: `{ "id": "shr_...", "project": "project-a", "label": "Alice", "token": "<24chars>", "created_at": "...", "expires_at": null, "share_url": "https://.../share/project-a/<token>" }`
- **AND** the exit code is 0

#### Scenario: `memon share create` human output
- **WHEN** an owner runs `memon share create project-a --format human`
- **THEN** stdout has the single line `https://.../share/project-a/<token>` and a trailing newline
- **AND** stderr is silent

#### Scenario: `memon share list` JSON across all projects
- **WHEN** an owner runs `memon share list` with two configured projects each having one share
- **THEN** stdout is a JSON array of 2 objects, each with `{ id, project, label, created_at, expires_at }` — NO `token` field

#### Scenario: `memon share list` filtered by project
- **WHEN** an owner runs `memon share list --project project-a --format human`
- **THEN** stdout is a table with columns `ID | Label | Created | Expires` listing only project-a's shares
- **AND** the `Token` column is absent

#### Scenario: `memon share revoke` unique id-prefix
- **WHEN** an owner runs `memon share revoke shr_abc --project project-a` and exactly one share matches
- **THEN** the matching record is removed from `<projectRoot>/.memon/shares.json`
- **AND** stdout (JSON default) is `{ "revoked": { "id": "shr_abc...", "project": "project-a", ... } }`
- **AND** the exit code is 0

#### Scenario: `memon share revoke` ambiguous without `--project`
- **WHEN** the prefix `shr_a` matches records in TWO different projects and `--project` is not supplied and `--force` is not supplied
- **THEN** the command exits with code 2 (usage error)
- **AND** stderr lists the candidate `(project, id)` pairs and instructs the user to disambiguate

#### Scenario: `memon share revoke` not found
- **WHEN** no record matches the given prefix/label
- **THEN** the command exits with code 1 (runtime error)
- **AND** stderr prints `share not found: <prefix>`

#### Scenario: `memon share create` with `--expires`
- **WHEN** an owner runs `memon share create project-a --expires 30d`
- **THEN** the resulting record's `expires_at` is `created_at + 30 days` in ISO8601+TZ
- **AND** the JSON output reflects the non-null `expires_at`

#### Scenario: `memon share create` invalid duration
- **WHEN** an owner runs `memon share create project-a --expires foo`
- **THEN** the command exits with code 2 (usage error)
- **AND** stderr reads `invalid --expires value: expected <int>d, <int>h, or "never"`

#### Scenario: Unknown project
- **WHEN** an owner runs `memon share create not-configured-project`
- **THEN** the command exits with code 1
- **AND** stderr reads `project not configured: not-configured-project`
