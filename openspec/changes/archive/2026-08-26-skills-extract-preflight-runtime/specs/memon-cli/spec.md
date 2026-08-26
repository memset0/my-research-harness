## MODIFIED Requirements

### Requirement: `memon install-skills` synchronises bundled skills into a project

`memon install-skills [--project-root <p>] [--target <path>] [--agent <list>] [--dry-run]` SHALL copy every `memon-*` subdirectory of the bundled `@memon/skills` source into one or more target directories AND SHALL copy the canonical `PREFLIGHT.md` from the bundled source as a sibling of the deposited `memon-*/` dirs in each populated target. The command SHALL be a strict synchroniser of the `memon-*` namespace within each target, plus the named `PREFLIGHT.md` sibling file:

- **Default target set (no `--target`, no `--agent`)**: ALL of `<projectRoot>/.claude/skills/`, `<projectRoot>/.codex/skills/`, `<projectRoot>/.opencode/skills/` SHALL be installed in a single run. When `--project-root` is omitted, `cwd` is used as `<projectRoot>`.
- **`--agent <list>`**: a comma-separated subset of `claude,codex,opencode` (or the literal `all`) SHALL select which agent dirs to install. The map from agent name to subpath is fixed: `claude → .claude/skills`, `codex → .codex/skills`, `opencode → .opencode/skills`. Unknown agent names SHALL exit 2 with `BAD_REQUEST`. The token `all` SHALL be the only value when present (mixing `all` with explicit agent names SHALL exit 2 with `BAD_REQUEST`).
- **`--target <path>`**: overrides per-agent derivation entirely; the install writes into exactly that one directory. `--target` and `--agent` SHALL be mutually exclusive (combining them exits 2 with `BAD_REQUEST`). `--target` and `--project-root` remain mutually exclusive.
- **Replacement scope per target**: every existing directory in the target whose name starts with `memon-` SHALL be removed before the fresh copy is written, including names that no longer exist in the bundled source. This rule applies independently to each target dir.
- **PREFLIGHT.md deposit per target**: every populated target dir SHALL have `PREFLIGHT.md` (case-sensitive) written as a sibling of the `memon-*/` dirs, sourced byte-for-byte from `packages/skills/PREFLIGHT.md` in the bundled source. If a stale `PREFLIGHT.md` already exists in the target, it SHALL be overwritten. PREFLIGHT.md SHALL be re-copied on every non-`--dry-run` invocation; there is no skip-if-unchanged shortcut. A stale `PREFLIGHT.md` SHALL NOT be removed under the `memon-*` replacement-scope rule (that rule is for namespaced dirs only); cleanup of an obsolete `PREFLIGHT.md` is the user's responsibility.
- **Non-namespaced files / directories per target**: directories not starting with `memon-` AND files other than `PREFLIGHT.md` SHALL NOT be read, written, or deleted in any target. (PREFLIGHT.md is the only sibling artifact under this synchroniser's contract; everything else outside the `memon-*` namespace is left alone.)
- **Atomic-ish per skill**: each `memon-*` is removed and re-copied as a unit; partial copies inside a single skill dir are fine since the next install re-runs.
- **Dry-run**: `--dry-run` SHALL output the same `targets[]` JSON a real run would produce, without touching any file. The AGENTS.md prompt SHALL be skipped in dry-run mode (reported with `action: "skipped-dry-run"`).
- **JSON output shape**: when `--format json`, stdout SHALL be a single JSON object with keys `ok`, `source`, `targets`, `agentsLink`, `dryRun`. `targets` SHALL be an array; each entry has `agent` (one of `"claude" | "codex" | "opencode" | null`), `path` (absolute), `removed[]`, `installed[]`. The `installed[]` array SHALL include the literal string `PREFLIGHT.md` whenever the synchroniser deposited the sibling file in that target (or would have, in `--dry-run`). The `agent` field SHALL be `null` when `--target` was used.

#### Scenario: Default install writes to all three agent dirs
- **WHEN** `memon install-skills --project-root /repo` runs with no `--agent` and no `--target`
- **THEN** all of `/repo/.claude/skills/`, `/repo/.codex/skills/`, and `/repo/.opencode/skills/` exist after the run
- **AND** each contains a fresh copy of every bundled `memon-*` directory
- **AND** each contains a `PREFLIGHT.md` file as a sibling of the `memon-*/` dirs
- **AND** stdout JSON has `targets.length === 3` with `agent` values `"claude"`, `"codex"`, `"opencode"` (in that order)
- **AND** every `targets[i].installed` array includes the literal string `"PREFLIGHT.md"`

#### Scenario: --agent claude restores single-target install
- **WHEN** `memon install-skills --project-root /repo --agent claude` runs
- **THEN** only `/repo/.claude/skills/` is created/updated
- **AND** `/repo/.codex/skills/` and `/repo/.opencode/skills/` are NOT created if they did not previously exist
- **AND** `/repo/.claude/skills/PREFLIGHT.md` exists after the run
- **AND** stdout JSON has `targets.length === 1` with `agent: "claude"`

#### Scenario: --agent accepts comma-separated subset
- **WHEN** `memon install-skills --project-root /repo --agent claude,opencode` runs
- **THEN** `/repo/.claude/skills/` and `/repo/.opencode/skills/` are populated, `/repo/.codex/skills/` is NOT
- **AND** `/repo/.claude/skills/PREFLIGHT.md` and `/repo/.opencode/skills/PREFLIGHT.md` both exist; `/repo/.codex/skills/PREFLIGHT.md` is NOT created
- **AND** stdout JSON has `targets.length === 2` with `agent` values `"claude"` and `"opencode"`

#### Scenario: --agent all is equivalent to omitting --agent
- **WHEN** `memon install-skills --project-root /repo --agent all` runs
- **THEN** all three agent dirs are populated, identical to running with no `--agent` flag
- **AND** all three target dirs contain `PREFLIGHT.md`

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
- **AND** any unrelated sibling files in the targets (e.g. ad-hoc notes, hand-written `README.md`) are left untouched, except `PREFLIGHT.md` which is overwritten from source

#### Scenario: --target overrides project-root derivation, agent is null
- **WHEN** `memon install-skills --target /opt/skills` runs
- **THEN** the command writes only to `/opt/skills`
- **AND** `/opt/skills/PREFLIGHT.md` exists after the run
- **AND** stdout JSON has `targets.length === 1` with `agent: null` and `path: "/opt/skills"`

#### Scenario: Default target with no --project-root uses cwd
- **WHEN** `memon install-skills` runs from `/repo` without flags
- **THEN** the targets are `/repo/.claude/skills/`, `/repo/.codex/skills/`, `/repo/.opencode/skills/`
- **AND** each target dir contains `PREFLIGHT.md`

#### Scenario: Stale PREFLIGHT.md in target is overwritten
- **GIVEN** `/repo/.claude/skills/PREFLIGHT.md` already exists with stale content
- **WHEN** `memon install-skills --project-root /repo --agent claude` runs
- **THEN** `/repo/.claude/skills/PREFLIGHT.md` exists after the run
- **AND** its bytes are equal to the bundled `packages/skills/PREFLIGHT.md`

#### Scenario: Dry-run reports PREFLIGHT.md without writing it
- **GIVEN** `/repo/.claude/skills/PREFLIGHT.md` does not exist
- **WHEN** `memon install-skills --project-root /repo --agent claude --dry-run` runs
- **THEN** the JSON `targets[0].installed` array includes `"PREFLIGHT.md"`
- **AND** `/repo/.claude/skills/PREFLIGHT.md` still does not exist on disk after the run
