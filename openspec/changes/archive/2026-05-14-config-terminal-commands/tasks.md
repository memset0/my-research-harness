## 1. Schema and types

- [x] 1.1 Extend `TerminalConfigRawSchema` in `packages/core/src/schemas.ts` with an optional `commands` field. Shape: `z.object({ none: z.array(z.string().min(1)).optional(), claude: z.array(z.string().min(1)).min(1).optional(), codex: z.array(z.string().min(1)).min(1).optional(), opencode: z.array(z.string().min(1)).min(1).optional() }).strict().optional()`. The `.strict()` rejects unknown agent keys at parse time (per spec scenario "Unknown agent key rejected"). The `.min(1)` on the array enforces non-empty for non-`none` agents; `commands.none` keeps `.array().optional()` only (empty is valid).
- [x] 1.2 Extend `TerminalConfig` in `packages/core/src/types.ts` with `commands: Record<AgentKind, readonly string[]>`. Re-export `AgentKind` from a shared module if `packages/core` doesn't have it yet — currently `AgentKind` is defined in `apps/web/lib/terminal/manager.ts`; moving the enum into core (or duplicating the literal union there) is required so the core types compile without depending on the web app. Prefer adding `AGENT_KINDS` / `AgentKind` to `packages/core/src/types.ts` and having `manager.ts` re-export from there.
- [x] 1.3 Extend `DEFAULT_TERMINAL` in `packages/core/src/config/load.ts` with `commands: { none: [], claude: ['claude'], codex: ['codex'], opencode: ['opencode'] }`. Mark the inner arrays `as const` so the type is `readonly string[]`.

## 2. Config load + validation

- [x] 2.1 In `packages/core/src/config/load.ts`, merge per-agent defaults: `commands: { none: cfg.terminal?.commands?.none ?? DEFAULT_TERMINAL.commands.none, claude: cfg.terminal?.commands?.claude ?? DEFAULT_TERMINAL.commands.claude, codex: cfg.terminal?.commands?.codex ?? DEFAULT_TERMINAL.commands.codex, opencode: cfg.terminal?.commands?.opencode ?? DEFAULT_TERMINAL.commands.opencode }`. Place this in the existing `const terminal: TerminalConfig = { ... }` block.
- [x] 2.2 Confirm `ConfigError` paths surface readable messages: the Zod parse already throws on `.strict()` violations and `.min(1)` violations, but the path it embeds is `terminal.commands.<agent>` — verify by hand that the existing `ConfigError` wrapping in `load.ts` carries those paths through. If the wrapping flattens too aggressively, add explicit messages naming `terminal.commands.<agent>` for the cases the spec calls out (empty-array non-`none`, empty-string element, unknown agent key).
- [x] 2.3 Add unit tests to `packages/core/src/config/load.test.ts` matching every scenario under the "terminal config block in config.yml" requirement that mentions `commands`: block-absent defaults, partial override, full override, `claude: []` rejected, `none: []` accepted, `claude: ["", "--continue"]` rejected, unknown agent `aider` rejected.

## 3. Wire commands through the terminal manager

- [x] 3.1 In `apps/web/lib/terminal/manager.ts`, extend `StartSessionInput` with `commands: Record<AgentKind, readonly string[]>` (required, not optional — the route is responsible for filling defaults from runtime). Update the JSDoc to reference the config block.
- [x] 3.2 In `doStartSession` (around line 444–465), replace the `if (agent !== 'none') tmuxTail.push(agent, ...resumeTail)` block with: read `const agentArgv = input.commands[agent]`, push `...agentArgv` (no `agent !== 'none'` guard — when `agentArgv` is `[]` the spread is a no-op), then push `...resumeTail` unchanged. The probe early-returns `[]` for `agent === 'none'`, so the existing semantics are preserved.
- [x] 3.3 In `apps/web/app/api/terminal/start/route.ts`, forward `runtime.config.terminal.commands` into the `startSession({ ..., commands })` call.
- [x] 3.4 Update `apps/web/lib/terminal/manager.test.ts`: existing tests that asserted argv tails with literal `claude` / `codex` strings should now pass `commands` explicitly in their test fixtures (e.g. `commands: { none: [], claude: ['claude'], codex: ['codex'], opencode: ['opencode'] }`). Add new tests for: custom `claude` argv replaces default, custom argv + resumable cwd appends `--continue`, custom `none` argv runs the user's command verbatim.

## 4. config.example.yml — commented defaults only

- [x] 4.1 In the committed `config.example.yml`, extend the existing commented-out `terminal:` block with a `commands:` sub-section showing every agent's default argv and a brief gotcha note about the appended resume tail. Keep it **commented out** so the example boots with full defaults. Example to embed (each line prefixed with `#`):

  ```yaml
  # terminal:
  #   commands:
  #     none: []                  # plain shell; tmux picks the default
  #     claude: ["claude"]
  #     codex: ["codex"]
  #     opencode: ["opencode"]
  #     # NOTE: the resume tail (e.g. ["--continue"] for claude when a prior
  #     # conversation exists for the cwd) is appended AFTER the user's argv.
  #     # If you wrap with bash -lc, the resume tail goes to bash, not to claude.
  ```

## 5. Verification

- [x] 5.1 `pnpm --filter @memon/core typecheck` clean.
- [x] 5.2 `pnpm --filter @memon/web typecheck` clean.
- [x] 5.3 `pnpm --filter @memon/core test` clean (covers new load.test.ts scenarios).
- [x] 5.4 `pnpm --filter @memon/web test -- manager.test` clean (covers new manager.test.ts argv scenarios).
- [x] 5.5 Per `CLAUDE.md` "Verification protocol for UI changes", restart the prod dashboard (kill old PID first, then `pnpm --filter @memon/core build && pnpm --filter @memon/web build && cd apps/web && pnpm start`) and exercise each agent variant from a run-detail page (`Open with Claude Code`, `Codex`, `Terminal`) with whatever local `config.yml` override is in effect on this host. Confirm the spawned pane reflects the configured argv (e.g. `echo $CLAUDE_CONFIG_DIR` / `echo $CODEX_HOME` print the values the local wrapper exports, and `claude --version` / `codex --version` work). Confirm an absent-override fallback path still works (delete the agent key from `commands` temporarily, restart, and verify the default agent name is used).
- [x] 5.6 `openspec validate config-terminal-commands --type change` clean.
