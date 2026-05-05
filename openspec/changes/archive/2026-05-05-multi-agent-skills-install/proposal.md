## Why

`memon install-skills` only writes to `<projectRoot>/.claude/skills/`, which silently shuts out users who run their work through other agent CLIs (Codex, opencode) alongside Claude Code. The skill markdown is identical in every case — the only thing that changes per agent is the directory it lives in — so the single-target hard-code is gratuitous lock-in. Today switching agents means re-running install with `--target` for each one and remembering the right path, which the user keeps forgetting.

A second papercut: agent CLIs that read `AGENTS.md` (Codex, opencode) ignore this repo's `CLAUDE.md`, so the same project guidance has to be re-stated. We can fix that opportunistically as part of the same install flow.

## What Changes

- **BREAKING (default behavior)** `memon install-skills` with no flags now installs into every supported agent's skills directory under `<projectRoot>/`: `.claude/skills/`, `.codex/skills/`, `.opencode/skills/`. The previous behavior (Claude only) was the implicit default; opt back into it with `--agent claude`.
- Add `--agent <list>` flag accepting a comma-separated subset of `claude,codex,opencode` (or the literal `all`, equivalent to omitting the flag). Selects which agent skill dirs to write.
- `--target <path>` continues to override the per-agent derivation **and** forces a single-directory install (mutually exclusive with `--agent`); preserves the existing escape hatch for one-off targets.
- After a successful (non-dry-run) install, if `<projectRoot>/CLAUDE.md` exists but `<projectRoot>/AGENTS.md` does not, the command **prompts** the user (interactive TTY only) whether to create a symlink `AGENTS.md → CLAUDE.md`. JSON / non-TTY runs MUST NOT prompt; they instead report the link's status as data.
- JSON output gains: `targets[]` (one entry per agent dir touched, each with its own `removed`/`installed` arrays), and an `agentsLink` object describing the AGENTS.md state and what the run did about it.
- Per-agent dry-run is preserved: `--dry-run` reports `targets[]` as if the run had executed.

## Capabilities

### New Capabilities
<!-- none -->

### Modified Capabilities
- `memon-cli`: the "memon install-skills synchronises bundled skills into a project" requirement is replaced by a multi-target version, plus a new requirement covering the AGENTS.md-symlink prompt.

## Impact

- Code: `packages/cli/src/commands/install-skills.ts` (target derivation, loop over agent set, AGENTS.md prompt + reporting), `packages/cli/src/index.ts` (new `--agent` flag), and any place that documents the command (README snippets, the `memon-skills` skill if it references the install path).
- Output schema: `memon install-skills --format json` shape changes — `removed`/`installed` move from top-level into per-target entries inside `targets[]`. Any caller that parsed the old shape needs to update; we know of none in-tree.
- User workflow: existing `--target` users are unaffected. Existing default-flag users (Claude only) will see new directories created on next run; this is intentional.
- No spec impact on `memon-skills` (the SKILL.md content is unchanged), `experiment-discovery`, or anything else; this is a CLI-surface change only.
