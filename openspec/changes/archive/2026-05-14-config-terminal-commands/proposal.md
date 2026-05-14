## Why

The "New Terminal" / "New Claude Code" affordances all spawn a tmux session and push a hard-coded command into the pane (`claude` / `codex` / `opencode`, or no command for plain shell). The user runs memon on more than one host — the cluster (where the unadorned binary names are exactly right) and a local laptop (where the binary lives at a different path / wants extra flags / needs a wrapper). Today there is no way to change that initial argv without editing `apps/web/lib/terminal/manager.ts` and rebuilding.

This change makes the per-agent tmux command configurable from `config.yml`, so the same source tree can boot identically on every host and the local override is just a few lines of YAML.

## What Changes

- Add `terminal.commands` map to `config.yml`: keyed by agent kind (`none | claude | codex | opencode`), each value is an `argv: string[]`. Per-host edit, no code change required.
- Defaults preserve current hard-coded behaviour exactly (`{ none: [], claude: ["claude"], codex: ["codex"], opencode: ["opencode"] }`), so existing configs are byte-equivalent after the upgrade.
- `terminal.commands.none` is the only override that may be `[]` — that's the existing "pure shell, no trailing command" mode. For every other agent the override SHALL be a non-empty array (rejected at config load with a clear error).
- The resume probe is unchanged: when `probeResumeArgvTail()` finds a resumable conversation, its tail (`["--continue"]` for claude today) is appended to the user-configured argv. The user accepted that `bash -lc "exec claude"` style wrappers will not pick up the resume tail — they can either embed `--continue` in their shell string or accept fresh starts.
- The committed `config.example.yml` (currently inlined as a comment in `config.yml`) grows a commented-out `terminal.commands:` block listing every agent with its default, so users can copy-uncomment-edit.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `browser-terminal`: the "Start a ttyd-backed terminal session bound to tmux" requirement's argv-tail table becomes parameterised by `terminal.commands[<agent>]` instead of hard-coding `claude` / `codex` / `opencode`; the "terminal config block in config.yml" requirement grows a `commands` sub-field with its validation rules.

## Impact

- **Code**: `packages/core/src/schemas.ts` (`TerminalConfigRawSchema` gains `commands?: Record<AgentKind, string[]>`), `packages/core/src/config/load.ts` (apply per-agent defaults + non-empty validation for non-`none` agents), `packages/core/src/types.ts` (`TerminalConfig` gains a `commands: Record<AgentKind, readonly string[]>` field), `apps/web/lib/terminal/manager.ts:444–465` (`doStartSession` reads the configured argv instead of literal `agent` push), `StartSessionInput` (gains `commands` field threaded from runtime), `apps/web/app/api/terminal/start/route.ts` (forwards `runtime.config.terminal.commands` into `startSession()`).
- **Config surface**: one new optional block in `config.yml`. No migration — absent block uses defaults.
- **Tests**: `manager.test.ts` (`doStartSession` argv composition assertions) and config-loader tests (`packages/core/src/config/load.test.ts`) gain coverage for the new field + the validation cases.
- **Spec**: `browser-terminal/spec.md` argv-tail table moves from literal commands to `<commands[agent]>` references; an added scenario covers a custom override.
- **No data migration**, **no breaking API change** for any HTTP endpoint, **no FS convention bump**. Existing tmux sessions on disk are unaffected (session names continue to use the agent kind, not the argv).
