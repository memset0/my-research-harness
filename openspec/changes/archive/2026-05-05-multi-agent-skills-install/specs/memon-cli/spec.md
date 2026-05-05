## MODIFIED Requirements

### Requirement: `memon install-skills` synchronises bundled skills into a project

`memon install-skills [--project-root <p>] [--target <path>] [--agent <list>] [--dry-run]` SHALL copy every `memon-*` subdirectory of the bundled `@memon/skills` source into one or more target directories. The command SHALL be a strict synchroniser of the `memon-*` namespace within each target:

- **Default target set (no `--target`, no `--agent`)**: ALL of `<projectRoot>/.claude/skills/`, `<projectRoot>/.codex/skills/`, `<projectRoot>/.opencode/skills/` SHALL be installed in a single run. When `--project-root` is omitted, `cwd` is used as `<projectRoot>`.
- **`--agent <list>`**: a comma-separated subset of `claude,codex,opencode` (or the literal `all`) SHALL select which agent dirs to install. The map from agent name to subpath is fixed: `claude → .claude/skills`, `codex → .codex/skills`, `opencode → .opencode/skills`. Unknown agent names SHALL exit 2 with `BAD_REQUEST`. The token `all` SHALL be the only value when present (mixing `all` with explicit agent names SHALL exit 2 with `BAD_REQUEST`).
- **`--target <path>`**: overrides per-agent derivation entirely; the install writes into exactly that one directory. `--target` and `--agent` SHALL be mutually exclusive (combining them exits 2 with `BAD_REQUEST`). `--target` and `--project-root` remain mutually exclusive.
- **Replacement scope per target**: every existing directory in the target whose name starts with `memon-` SHALL be removed before the fresh copy is written, including names that no longer exist in the bundled source. This rule applies independently to each target dir.
- **Non-namespaced skills are untouched per target**: directories not starting with `memon-` SHALL NOT be read, written, or deleted in any target.
- **Atomic-ish per skill**: each `memon-*` is removed and re-copied as a unit; partial copies inside a single skill dir are fine since the next install re-runs.
- **Dry-run**: `--dry-run` SHALL output the same `targets[]` JSON a real run would produce, without touching any file. The AGENTS.md prompt SHALL be skipped in dry-run mode (reported with `action: "skipped-dry-run"`).
- **JSON output shape**: when `--format json`, stdout SHALL be a single JSON object with keys `ok`, `source`, `targets`, `agentsLink`, `dryRun`. `targets` SHALL be an array; each entry has `agent` (one of `"claude" | "codex" | "opencode" | null`), `path` (absolute), `removed[]`, `installed[]`. The `agent` field SHALL be `null` when `--target` was used.

#### Scenario: Default install writes to all three agent dirs
- **WHEN** `memon install-skills --project-root /repo` runs with no `--agent` and no `--target`
- **THEN** all of `/repo/.claude/skills/`, `/repo/.codex/skills/`, and `/repo/.opencode/skills/` exist after the run
- **AND** each contains a fresh copy of every bundled `memon-*` directory
- **AND** stdout JSON has `targets.length === 3` with `agent` values `"claude"`, `"codex"`, `"opencode"` (in that order)

#### Scenario: --agent claude restores single-target install
- **WHEN** `memon install-skills --project-root /repo --agent claude` runs
- **THEN** only `/repo/.claude/skills/` is created/updated
- **AND** `/repo/.codex/skills/` and `/repo/.opencode/skills/` are NOT created if they did not previously exist
- **AND** stdout JSON has `targets.length === 1` with `agent: "claude"`

#### Scenario: --agent accepts comma-separated subset
- **WHEN** `memon install-skills --project-root /repo --agent claude,opencode` runs
- **THEN** `/repo/.claude/skills/` and `/repo/.opencode/skills/` are populated, `/repo/.codex/skills/` is NOT
- **AND** stdout JSON has `targets.length === 2` with `agent` values `"claude"` and `"opencode"`

#### Scenario: --agent all is equivalent to omitting --agent
- **WHEN** `memon install-skills --project-root /repo --agent all` runs
- **THEN** all three agent dirs are populated, identical to running with no `--agent` flag

#### Scenario: Unknown agent name exits 2
- **WHEN** the user runs `memon install-skills --agent claude,bard`
- **THEN** the command exits with code 2
- **AND** stderr contains a `BAD_REQUEST` error mentioning `bard` and the allowed values

#### Scenario: Mixing all with explicit names exits 2
- **WHEN** the user runs `memon install-skills --agent all,claude`
- **THEN** the command exits with code 2 with a `BAD_REQUEST` error

#### Scenario: --agent and --target are mutually exclusive
- **WHEN** the user runs `memon install-skills --agent claude --target /tmp/foo`
- **THEN** the command exits with code 2 with a `BAD_REQUEST` error

#### Scenario: Stale memon-* dir is removed independently in each target
- **GIVEN** `/repo/.claude/skills/memon-renamed-old/` and `/repo/.codex/skills/memon-renamed-old/` both exist
- **WHEN** `memon install-skills --project-root /repo` runs (default agents)
- **THEN** both `memon-renamed-old/` directories are deleted
- **AND** the corresponding `targets[]` entries each include `memon-renamed-old` in `removed[]`

#### Scenario: Non-namespaced skills are preserved per target
- **GIVEN** `/repo/.claude/skills/openspec-propose/` and `/repo/.opencode/skills/my-thing/` exist
- **WHEN** `memon install-skills --project-root /repo` runs
- **THEN** both directories' contents and mtimes are unchanged after the run

#### Scenario: --target overrides project-root derivation, agent is null
- **WHEN** `memon install-skills --target /opt/skills` runs
- **THEN** the command writes only to `/opt/skills`
- **AND** stdout JSON has `targets.length === 1` with `agent: null` and `path: "/opt/skills"`

#### Scenario: Default target with no --project-root uses cwd
- **WHEN** `memon install-skills` runs from `/repo` without flags
- **THEN** the targets are `/repo/.claude/skills/`, `/repo/.codex/skills/`, `/repo/.opencode/skills/`

### Requirement: `memon install-skills` offers an AGENTS.md → CLAUDE.md symlink

After a successful (non-`--dry-run`) install, `memon install-skills` SHALL inspect `<projectRoot>/AGENTS.md` and `<projectRoot>/CLAUDE.md` and react as follows. (When `--target` is used, "project root" for this check is the resolved `--project-root` or `cwd`, NOT the `--target` directory.)

- If `AGENTS.md` exists (regular file, symlink, anything `lstat`-able): take no action; report `action: "none"`.
- Else if `CLAUDE.md` does NOT exist: take no action; report `action: "none"`.
- Else (CLAUDE.md exists, AGENTS.md does not):
  - If `--format json`, OR stdin is not a TTY, OR `--dry-run`: SHALL NOT prompt; SHALL report `action: "skipped-non-tty"` (or `"skipped-dry-run"` for the dry-run case) and SHALL NOT create the symlink.
  - Otherwise: SHALL print one Chinese-language confirmation prompt (e.g. `是否创建 AGENTS.md → CLAUDE.md 软链接？(y/N)`) to stdout and read a single line from stdin. On `y`/`Y`/`yes` (case-insensitive), SHALL create `<projectRoot>/AGENTS.md` as a symlink whose target is the relative string `CLAUDE.md`, then report `action: "created"`. On any other answer (including empty line or EOF), SHALL report `action: "declined"` and create no symlink.
  - On a filesystem error during symlink creation (e.g. EPERM, ENOTSUP), SHALL catch the error and report `action: "failed"` with the error message in `agentsLink.error`. The overall command exit code SHALL still be 0 if the skill copy succeeded.
- The check SHALL run exactly once per invocation, AFTER all targets are processed (or AFTER dry-run reporting), regardless of how many targets there are.
- The reported state SHALL appear in the human-output trailer as a single line, and in JSON output as an `agentsLink` object with fields: `checked: true`, `claudeMdExists: boolean`, `agentsMdExists: boolean`, `action: "none" | "created" | "declined" | "skipped-non-tty" | "skipped-dry-run" | "skipped-no-input" | "failed"`, optional `error: string`.

#### Scenario: Both files already exist — no prompt
- **GIVEN** `<projectRoot>/AGENTS.md` and `<projectRoot>/CLAUDE.md` both exist
- **WHEN** `memon install-skills --project-root <projectRoot>` runs in an interactive terminal
- **THEN** no prompt is shown
- **AND** stdout JSON has `agentsLink.action === "none"` with `agentsMdExists: true`

#### Scenario: Neither file exists — no prompt
- **GIVEN** neither `AGENTS.md` nor `CLAUDE.md` exists at `<projectRoot>`
- **WHEN** `memon install-skills --project-root <projectRoot>` runs
- **THEN** no prompt is shown
- **AND** stdout JSON has `agentsLink.action === "none"` with `claudeMdExists: false`

#### Scenario: CLAUDE.md exists, AGENTS.md missing, interactive — accepts y
- **GIVEN** `<projectRoot>/CLAUDE.md` exists and `<projectRoot>/AGENTS.md` does not
- **WHEN** `memon install-skills --project-root <projectRoot>` runs in an interactive TTY and the user types `y` followed by Enter
- **THEN** `<projectRoot>/AGENTS.md` exists as a symlink whose readlink target is the literal string `CLAUDE.md`
- **AND** stdout JSON (if `--format json` were used) would report `agentsLink.action === "created"`

#### Scenario: CLAUDE.md exists, AGENTS.md missing, interactive — declined
- **GIVEN** the same state as the previous scenario
- **WHEN** the user types `n` (or just Enter) at the prompt
- **THEN** no symlink is created
- **AND** the command reports `agentsLink.action === "declined"`

#### Scenario: --format json suppresses the prompt
- **GIVEN** `<projectRoot>/CLAUDE.md` exists and `<projectRoot>/AGENTS.md` does not
- **WHEN** `memon install-skills --project-root <projectRoot> --format json` runs (even in an interactive TTY)
- **THEN** no prompt is shown
- **AND** stdout JSON has `agentsLink.action === "skipped-non-tty"`
- **AND** no symlink is created

#### Scenario: --dry-run suppresses both copy and prompt
- **WHEN** `memon install-skills --project-root <projectRoot> --dry-run` runs with CLAUDE.md present and AGENTS.md absent
- **THEN** no files are written and no symlink is created
- **AND** stdout JSON has `agentsLink.action === "skipped-dry-run"`

#### Scenario: Symlink creation failure does not fail the install
- **GIVEN** `<projectRoot>/CLAUDE.md` exists, `<projectRoot>/AGENTS.md` does not, the user accepts the prompt, but the filesystem rejects symlink creation (e.g. read-only mount)
- **WHEN** `memon install-skills --project-root <projectRoot>` runs
- **THEN** the command exits with code 0
- **AND** stdout JSON has `agentsLink.action === "failed"` with a non-empty `error` string
- **AND** the skill copy results in `targets[]` are unaffected
