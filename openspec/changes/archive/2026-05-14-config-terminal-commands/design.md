## Context

`apps/web/lib/terminal/manager.ts:444–465` builds the tmux argv tail for every browser-spawned terminal by literally pushing the `AgentKind` string (`claude` / `codex` / `opencode`) into argv and appending the resume probe's tail. The agent kind doubles as the binary name. That's fine on the dev cluster — but the same source tree is also run locally by the user, where the binary name, path, or default flags need to differ. Today the only way to change that is to fork `manager.ts` and rebuild.

The existing `terminal:` config block (`packages/core/src/schemas.ts` `TerminalConfigRawSchema`) already covers ttyd cap / idle TTL / pane-info polling intervals. Adding a per-agent argv map under the same block is the natural place to grow.

The resume probe (`probeResumeArgvTail` at `manager.ts:298–320`) is left untouched: it still emits an `--continue`-flavoured tail when the agent's local conversation store says there's something to reattach, and that tail is still appended to the configured argv as the final argv elements.

## Goals / Non-Goals

**Goals:**
- One YAML edit to change `new claude code` (and friends) per host. No code change, no rebuild.
- Zero-touch defaults: configs that don't mention `terminal.commands` boot byte-identically to today.
- Validation rejects obviously-broken overrides at `loadConfig` time (empty argv for an agent that's supposed to run *something*, non-string elements, empty-string first arg) — not at first-use-and-tmux-exits-immediately time.
- Per-agent partial override (touch only `claude:` if that's what you want; `codex:` / `opencode:` / `none:` keep their defaults).

**Non-Goals:**
- **No per-project override.** Decided in proposal review: the user runs memon on per-host configs, so global is sufficient and per-project nesting would add a resolution layer for no real-world benefit.
- **No separate `resume_args` field.** Decided in proposal review: resume tail (`--continue` etc.) is always appended to the user's argv, exactly as today. `bash -lc "exec claude"` style wrappers therefore won't surface the resume tail; the user accepted this trade-off.
- **No env-var or working-directory override per agent.** `cwd` is still derived from `(project, scope, slug)` per the existing spec. Env wrappers are the user's job (write `["bash","-lc","source ~/.envrc && exec claude"]` if needed).
- **Session-name format is unchanged.** Session names still encode `<agent>`, not the argv. This keeps `start` idempotency, the management page parser, and dedup across drawer+popup working without touching them.

## Decisions

### D1. Shape: `terminal.commands: Record<AgentKind, string[]>` under the existing `terminal:` block

```yaml
terminal:
  commands:
    none: []                # no trailing command — pure shell
    claude: ["claude"]
    codex: ["codex"]
    opencode: ["opencode"]
```

**Rationale:** matches the user's selected option (flat map keyed by agent). Grows naturally from the existing `terminal:` block. Each value is a YAML array which round-trips through Zod with no `shellwords`-style parsing, avoiding the well-known quoting surprises of single-string commands (the next person who wants `claude --model "claude-sonnet-4-6"` doesn't have to think about quote levels).

**Alternative considered:** per-agent block with sub-fields (`command:` + `resume_args:` etc.). Rejected by the user during proposal review — single-array form is simpler and we don't need the sub-fields under the chosen resume model.

### D2. Defaults merge per-agent, not whole-block

If the user writes:

```yaml
terminal:
  commands:
    claude: ["claude", "--dangerously-skip-permissions"]
```

then `codex` / `opencode` / `none` keep their default argv (`["codex"]` / `["opencode"]` / `[]`). The merge happens in `config/load.ts` keyed on `AgentKind`, after the Zod parse. This matches how every other field in the `terminal:` block already behaves (omit a field → default fills in).

**Alternative considered:** whole-block-or-default (user must spell out all four agents if they want any override). Rejected — pointless verbosity, easy footgun (forget one and silently lose the resume probe).

### D3. Validation: per-agent rules at load time

- `commands` is `Record<AgentKind, string[]>`; unknown keys (e.g. `commands.aider`) are rejected by the Zod schema with `unrecognized key`.
- Every element of every argv MUST be a `string` of length ≥ 1 (Zod `z.string().min(1)`). Catches `[""]` / `[null]` mistakes.
- For agents **other than** `none`, the argv MUST be a non-empty array (`z.array(...).min(1)`). `claude: []` is rejected — if the user actually wants "no agent", they pick `agent: 'none'` on the call site; an explicitly-named agent silently launching as a shell is a confusing failure mode worth hard-erroring on.
- For `none`, `[]` is valid (it's the default!) and means "no trailing command, just tmux's default shell."

All validation errors are thrown as `ConfigError` from `loadConfig` with messages that name the offending agent and the rule that fired.

### D4. Resume probe unchanged, tail still appended to user argv

`probeResumeArgvTail` keeps emitting `["--continue"]` for claude / TBD-tails for codex+opencode when a conversation exists. The wired-up flow becomes:

```
tmuxTail = ['tmux','new-session','-A','-s',sessionName,'-c',cwd,
            ...commands[agent],         // was: agent (one string)
            ...resumeTail]              // unchanged
```

When `commands[agent] = []` (the `none` case), no command bytes are pushed — same as `if (agent !== 'none') tmuxTail.push(agent)` does today.

`resumeTail` is suppressed for `agent === 'none'` already (probe early-returns `[]`); that branch is unchanged.

### D5. Threading: `runtime.config.terminal.commands` → `StartSessionInput.commands`

`apps/web/app/api/terminal/start/route.ts` reads `runtime.config.terminal.commands` and passes it down through `startSession({ ..., commands })`. `manager.ts` `StartSessionInput` grows a `commands: Record<AgentKind, readonly string[]>` field. `doStartSession` uses `input.commands[agent]` for the argv push.

The manager is intentionally NOT given a fallback to defaults — the route is responsible for filling them in from `runtime.config.terminal.commands` (which `loadConfig` already populated with defaults). One source of truth.

### D6. `commands.none` override is a deliberate hook for `bash` / `zsh` / etc.

A user who wants `zsh` instead of the system shell can set `commands.none: ["zsh"]`. The default `[]` preserves the current "tmux picks its default shell" behaviour. We're not promising any pretty-printing here — the override is literal argv pushed to the tmux command.

## Risks / Trade-offs

- **[`bash -lc "exec claude"` wrappers lose resume tail]** → Documented in the proposal; the user explicitly chose this option. Mitigation: when applying, add a one-line comment in `config.example.yml` next to the `claude:` default mentioning this gotcha. No runtime warning (we don't want to nag).
- **[A user sets `commands.claude: ["does-not-exist"]` and the tmux pane exits immediately]** → No behaviour change here from today's "PATH miss → tmux exits early → warning surfaces via early-stderr capture in `manager.ts:472–478`." The existing warning path is sufficient.
- **[Future agent kind added to `AGENT_KINDS` but not to defaults]** → Type system catches this: `Record<AgentKind, ...>` is exhaustive in TypeScript, so the `DEFAULT_TERMINAL.commands` constant fails to compile if an `AgentKind` member is missing. Also caught at `loadConfig` because the merged-defaults object must have every key.
- **[Sensitive args in `config.yml`]** → `config.yml` already stores the plaintext owner password. Adding an `--api-key SECRET` arg to `commands.claude` is no worse than today; the threat model is single-user-host-fs-trust = auth-trust (per `auth-system` spec). No new disclosure path.
- **[CLI subcommands like `memon serve` boot before this code path]** → `terminal.commands` only affects HTTP `start` calls. `loadConfig` runs once at boot and surfaces validation errors there; no lazy second load.

## Migration Plan

No migration. `terminal.commands` is optional with defaults that match current behaviour. Existing `config.yml` files keep working. Existing running tmux sessions on disk are unaffected (they were spawned with whatever argv was current when they started; reattach just re-runs `tmux new-session -A` which no-ops on an existing session).

Rollback: revert the runtime/test PR. No on-disk state to undo.

## Open Questions

None. The two design pivots (granularity, resume composition) were settled during proposal review.
