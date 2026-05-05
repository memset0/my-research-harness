## 1. Wire the agent-target map and flag

- [x] 1.1 Add `AGENT_TARGETS` constant in `packages/cli/src/commands/install-skills.ts` mapping `claude → .claude/skills`, `codex → .codex/skills`, `opencode → .opencode/skills`. Export the `AgentName` type.
- [x] 1.2 Add `--agent <list>` to the `install-skills` `Command` registration in `packages/cli/src/index.ts`. Description references the comma-separated list and `all` synonym.
- [x] 1.3 Add a parser helper `parseAgentList(raw: string | undefined): AgentName[]` that handles undefined → all three, `"all"` → all three, comma-split → validated subset, rejects unknown names and `all` mixed with explicit names with a `BAD_REQUEST` exit-2.
- [x] 1.4 Update `InstallSkillsInput` to add `agents?: AgentName[]`. Drop the implicit "single target derived from projectRoot" behaviour; resolve to a list of `{ agent: AgentName | null, path: string }` instead.

## 2. Reject incompatible flag combos

- [x] 2.1 In `resolveTarget` (or its replacement), reject `--target` + `--agent` with a `BAD_REQUEST` exit-2.
- [x] 2.2 Keep the existing `--target` + `--project-root` rejection.
- [x] 2.3 Confirm `--agent` works with `--project-root` and with bare cwd.

## 3. Loop the install over multiple targets

- [x] 3.1 Refactor `runInstallSkills` to compute `targets: { agent: AgentName | null, path: string }[]` once and then run the existing wipe-and-copy logic against each entry.
- [x] 3.2 Per-target `removed[]` / `installed[]` are collected into a `targets[]` array in the JSON output.
- [x] 3.3 Ensure `--dry-run` still produces the same `targets[]` shape without any fs writes.
- [x] 3.4 Update the human-output branch to print one block per target, in the order they appear in `targets[]`.

## 4. AGENTS.md → CLAUDE.md prompt

- [x] 4.1 After the copy loop (or after dry-run reporting), implement `maybeOfferAgentsLink({ projectRoot, dryRun, format })` returning the `agentsLink` payload described in the spec.
- [x] 4.2 Existence checks use `fs.lstat` (so a broken symlink at `AGENTS.md` is treated as "exists, do nothing").
- [x] 4.3 In TTY interactive mode, print the Chinese-language prompt (`是否创建 AGENTS.md → CLAUDE.md 软链接？(y/N)`) and read one line from stdin; accept `y`/`Y`/`yes`/`YES` (case-insensitive) only.
- [x] 4.4 Implement a 30-second no-input timeout that resolves to `action: "skipped-no-input"` so a misdetected TTY can't hang the command.
- [x] 4.5 On accept, `fs.symlink('CLAUDE.md', join(projectRoot, 'AGENTS.md'))` (relative target). Catch errors and report `action: "failed"` without failing the run.
- [x] 4.6 Suppress the prompt when `format === 'json'`, `!process.stdin.isTTY`, or `dryRun === true`; report the appropriate `skipped-*` action.

## 5. Output schema + caller updates

- [x] 5.1 Update `emitJson` payload to the new shape: `{ ok, source, targets, agentsLink, dryRun }`. Remove the legacy top-level `removed` / `installed` fields.
- [x] 5.2 Update the human-output trailer to include the AGENTS.md status line.
- [x] 5.3 Grep the repo (`packages/cli`, `packages/skills`, `apps/web`) for any consumer of the old install-skills JSON shape; there should be none, but if found, update them.

## 6. Tests

- [x] 6.1 Create `packages/cli/src/commands/install-skills.test.ts`. Use a tmpdir per test (`fs.mkdtemp`) as the project root.
- [x] 6.2 Test: default install creates all three agent dirs with full skill content.
- [x] 6.3 Test: `--agent claude` only writes `.claude/skills/`; the other two dirs are NOT created.
- [x] 6.4 Test: `--agent claude,opencode` writes exactly those two.
- [x] 6.5 Test: `--agent all` is equivalent to omitting the flag.
- [x] 6.6 Test: unknown agent name exits 2 with `BAD_REQUEST`.
- [x] 6.7 Test: `--agent all,claude` exits 2 with `BAD_REQUEST`.
- [x] 6.8 Test: `--agent` + `--target` exits 2 with `BAD_REQUEST`.
- [x] 6.9 Test: stale `memon-renamed-old/` is removed independently in each target.
- [x] 6.10 Test: non-namespaced skill dirs (`openspec-foo/`, `my-thing/`) are byte-identical before/after in each target.
- [x] 6.11 Test (AGENTS.md): both files exist → `action: "none"`, no symlink touched.
- [x] 6.12 Test (AGENTS.md): neither file exists → `action: "none"`.
- [x] 6.13 Test (AGENTS.md): CLAUDE.md only, `--format json` → `action: "skipped-non-tty"`, no symlink created.
- [x] 6.14 Test (AGENTS.md): CLAUDE.md only, `--dry-run` → `action: "skipped-dry-run"`, no fs writes.
- [x] 6.15 Test (AGENTS.md): symlink creation failure (e.g. pre-existing AGENTS.md as a directory rendered after the lstat — simulate by mocking `fs.symlink` to throw) → `action: "failed"`, exit 0.

## 7. Spec sync + docs

- [x] 7.1 Run `openspec validate multi-agent-skills-install --type change` until clean.
- [x] 7.2 Update any in-repo doc that mentions `memon install-skills` (search for the string in `README.md`, `packages/skills/README.md`, `packages/cli/README.md` if present).
- [x] 7.3 Update `CLAUDE.md` if the install-skills behaviour is referenced there (currently it isn't, but verify).

## 8. Manual verification

- [x] 8.1 In a tmp dir, run `memon install-skills --project-root .` and confirm three skills directories appear.
- [x] 8.2 Add a `CLAUDE.md` and re-run; answer `y` at the prompt; confirm `AGENTS.md` exists and `readlink AGENTS.md` returns `CLAUDE.md`.
- [x] 8.3 Re-run without removing the symlink; confirm no second prompt and `agentsLink.action === "none"`.
- [x] 8.4 Run with `--format json` against the same project; confirm the prompt is suppressed and the JSON shape matches the spec.
