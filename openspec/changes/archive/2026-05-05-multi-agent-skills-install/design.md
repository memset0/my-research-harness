## Context

`packages/cli/src/commands/install-skills.ts` (current implementation, ~140 lines) does three things:

1. Resolve the bundled `@memon/skills` source dir (`SKILLS_DIR`).
2. Resolve a single target dir (default `<projectRoot>/.claude/skills/`, override via `--target`).
3. Wipe every `memon-*` subdir of that target and re-copy from source. Emits a flat `{removed[], installed[]}` JSON.

The user runs the same skill content under three agent CLIs in parallel — Claude Code (`.claude/skills/`), Codex (`.codex/skills/`), opencode (`.opencode/skills/`) — and is tired of re-running with `--target`. They also want the install flow to opportunistically symlink `AGENTS.md → CLAUDE.md` so non-Claude agents pick up the same project guidance, but only as a friendly prompt, never silently.

This is a CLI-surface change. The bundled skill markdown is unchanged. No spec other than `memon-cli` is affected.

## Goals / Non-Goals

**Goals:**
- One default invocation (`memon install-skills`) sets up skills for all three agents.
- A clean opt-out (`--agent claude`) for users who only want one.
- Per-agent JSON reporting so callers can see what happened in each target without re-parsing free-form text.
- An interactive AGENTS.md prompt that's safe in non-TTY / `--format json` runs (never blocks, never assumes "yes").
- Cluster-safe behavior — no extra fs surface beyond the existing copy.

**Non-Goals:**
- We are NOT installing to user-level dirs (`~/.claude/skills/`); the command stays project-scoped.
- We are NOT extending the install scope beyond `memon-*` namespaced skills (the existing strict-sync rule still applies, per agent dir).
- We are NOT rewriting CLAUDE.md content for AGENTS.md consumers; the symlink is the entire mechanism.
- We are NOT introducing a config file (`config.yml` agent list); the `--agent` flag is the only knob.

## Decisions

### D1. Default = all three agents, opt-out via `--agent`

Pick: install to `.claude/skills/`, `.codex/skills/`, `.opencode/skills/` by default. Override with `--agent claude` (or `claude,opencode`, etc.). Accept the literal `--agent all` as an explicit synonym for the default.

Rationale: the user's complaint is that they keep forgetting to run the install three times. Defaulting to "all" inverts the cost: someone who only uses Claude pays a cheap opt-out, while someone using all three (the user) pays nothing. Skill content is identical, so over-installing has no semantic cost — just three small directory copies.

Alternatives considered:
- **Auto-detect agent dirs (only install where the parent dir already exists).** Rejected: this is too magical, and the user explicitly wants all three even on a fresh project root. Detection-based logic also creates a "why didn't it install?" debugging hole.
- **Keep Claude as default, add `--agents` to opt in.** Rejected: this preserves the exact papercut the user is reporting.
- **Add a `config.yml` setting.** Rejected: violates the "no hidden state" principle that already governs `--project-root` resolution; a flag is enough.

### D2. `--agent` and `--target` are mutually exclusive

`--target <path>` already targets a single directory. Combining it with `--agent` would force us to invent semantics ("apply target only to claude, derive others?"). Instead: passing both exits 2 with `BAD_REQUEST`, mirroring the existing `--target` × `--project-root` rule. `--target` keeps its escape-hatch role; `--agent` is for the default per-agent layout.

### D3. Per-target JSON entries

JSON output becomes:

```json
{
  "ok": true,
  "source": "/abs/path/to/@memon/skills",
  "targets": [
    { "agent": "claude",   "path": "/repo/.claude/skills",   "removed": [...], "installed": [...] },
    { "agent": "codex",    "path": "/repo/.codex/skills",    "removed": [...], "installed": [...] },
    { "agent": "opencode", "path": "/repo/.opencode/skills", "removed": [...], "installed": [...] }
  ],
  "agentsLink": { "checked": true, "claudeMdExists": true, "agentsMdExists": false, "action": "skipped-non-tty" },
  "dryRun": false
}
```

When `--target <path>` is used, `targets[]` has a single entry with `agent: null` (or the literal string `"explicit-target"`; pick one and stick with it — see Open Questions).

Human output mirrors this: one block per target, plus an AGENTS.md line at the end. Old single-`{removed,installed}` shape is removed, not aliased — the proposal already calls this BREAKING.

### D4. AGENTS.md prompt: TTY-only, never blocking

Logic, after the copy loop succeeds (or after dry-run reporting):

1. Check `<projectRoot>/AGENTS.md`. If it exists (file, symlink, anything `lstat`-able), do nothing; report `agentsMdExists: true, action: "none"`.
2. Else check `<projectRoot>/CLAUDE.md`. If it doesn't exist, do nothing; report `claudeMdExists: false, action: "none"`.
3. Else (CLAUDE.md exists, AGENTS.md doesn't):
   - If `--format json` OR stdin/stdout isn't a TTY OR `--dry-run`: report `action: "skipped-non-tty"` (or `"skipped-dry-run"`) without prompting.
   - Else: print one line in Chinese asking whether to symlink (`是否创建 AGENTS.md → CLAUDE.md 软链接？(y/N)`) and read a single line from stdin. On y/Y/yes → `fs.symlink('CLAUDE.md', '<projectRoot>/AGENTS.md')` (relative target, so the link survives a project move) → report `action: "created"`. Anything else → `action: "declined"`.
   - On EPERM / ENOTSUP (e.g. Windows without dev-mode): catch, report `action: "failed"` with the error message; the install run still exits 0 because the skill copy succeeded.

Rationale: matches the repo convention that conversational dialogue with the user is in Chinese while skill content is in English; treats the symlink as a courtesy, never a requirement; keeps the whole feature trivially scriptable by setting `--format json` (which guarantees no prompt).

Alternatives considered:
- **Always create the symlink without asking.** Rejected: too surprising for a command whose sole prior job was copying skill files. The user might already have an AGENTS.md plan.
- **Add a `--link-agents` / `--no-link-agents` pair.** Rejected: noisier surface for a one-shot side-effect; the user's intent ("ask me") is best served by an interactive prompt with a clean non-TTY fallback. We can add an explicit flag later if the prompt proves annoying.

### D5. Agent → directory mapping is hard-coded (not pluggable)

Mapping lives in a constant in `install-skills.ts`:

```ts
const AGENT_TARGETS = {
  claude:   '.claude/skills',
  codex:    '.codex/skills',
  opencode: '.opencode/skills',
} as const
```

Adding a new agent = one PR touching this map plus the `--agent` value list. We don't need a registry / config-file mechanism for an exhaustive enum of three.

## Risks / Trade-offs

- **Risk: existing CI scripts parse the old flat `{removed, installed}` JSON.** → Mitigation: this is called out as BREAKING in the proposal; in-repo we know of no callers. The change archives the old requirement and replaces it, so the spec history is honest.
- **Risk: `.codex/` or `.opencode/` directory doesn't exist on disk yet.** → Mitigation: `fs.mkdir(target, { recursive: true })` already handles this for `.claude/`; same code path covers the new dirs.
- **Risk: TTY detection (`process.stdin.isTTY`) returns true under `script(1)` / some PTY wrappers and we accidentally block.** → Mitigation: the prompt is single-line with a 30-second `setTimeout` fallback that treats no-input as "no" and reports `action: "skipped-no-input"`. Keeps the blast radius small even when detection lies.
- **Risk: Symlink survives a `rm -rf .claude/` cleanup but points at nothing if user later deletes `CLAUDE.md`.** → Mitigation: that's a user choice; we document it briefly in the human output ("symlinked AGENTS.md → CLAUDE.md (relative; remove if you delete CLAUDE.md)"). The symlink is relative, so moving the project doesn't break it.
- **Trade-off: defaulting to all-three agents creates 3× as many directories on `memon install-skills` for users who only use Claude.** Acceptable: empty `.codex/skills/` / `.opencode/skills/` are cheap, named obviously, and the `--agent claude` opt-out is one flag away.

## Open Questions

- **`targets[].agent` value when `--target <path>` is used.** Two reasonable choices: `null` (cleanly signals "no agent — explicit override") or the literal string `"custom"`. Both serialise fine. Resolution proposed: use `null` — JSON consumers can branch on truthiness; the human output prints `target: <path>` without an agent label.
- **Should `--agent all` be allowed alongside e.g. `--agent claude,all`?** Resolution proposed: `all` is a single-value-only synonym; mixing it with explicit names is rejected as `BAD_REQUEST`. Keeps parsing trivial.
