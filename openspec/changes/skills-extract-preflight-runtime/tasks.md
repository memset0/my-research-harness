## 1. Author the canonical doc

- [ ] 1.1 Create `packages/skills/PREFLIGHT.md`. Top-level heading `# Preflight — FS convention version`. Body extracted verbatim from `packages/skills/memon-write-script/SKILL.md` lines 17–42 (the `## Preflight — FS convention version` section), promoted to a standalone doc:
  - One-paragraph intro describing what the doc is for and which skills consult it (the seven spec-mutating skills).
  - The 4-branch list (`match`, `behind`, `uninitialised`, `ahead`) with each branch's user-facing recommendation, byte-equal to the source skill's wording.
  - A closing paragraph naming `memon-migrate-fs` as exempt and explaining why (it IS the migration runtime; reads `.memon/version.json` directly).
- [ ] 1.2 Verify all four status values appear and the migrate-fs exemption is present: `grep -E '\\b(match|behind|uninitialised|ahead)\\b' packages/skills/PREFLIGHT.md` and `grep memon-migrate-fs packages/skills/PREFLIGHT.md`.

## 2. Extend install-skills to deposit PREFLIGHT.md

- [ ] 2.1 Read the current `packages/cli/src/commands/install-skills.ts`. Identify the per-target write loop where each `memon-*/` dir is copied.
- [ ] 2.2 After the per-target write loop, add a copy step that reads `<source>/PREFLIGHT.md` (using the `SKILLS_DIR` export from `@memon/skills`) and writes it to `<target>/PREFLIGHT.md`. Use `fs.copyFileSync` or equivalent that overwrites unconditionally.
- [ ] 2.3 In `--dry-run` mode, the copy SHALL be a no-op on disk but the file's name SHALL still appear in the target's `installed[]` array.
- [ ] 2.4 The string `"PREFLIGHT.md"` is appended to each populated target's `installed[]` array. (Existing strings are skill dir basenames; this is one additional element.)
- [ ] 2.5 Confirm the `removed[]` logic is unaffected: `PREFLIGHT.md` is NOT subject to the `memon-*` replacement-scope rule. (i.e. if a target has a stale `PREFLIGHT.md` AND a stale `memon-foo/`, only the latter goes into `removed[]`.)

## 3. Tests

- [ ] 3.1 Add a test case to `packages/cli/src/commands/install-skills.test.ts`: default 3-target install. Assert each target dir contains `PREFLIGHT.md` whose bytes equal `<SKILLS_DIR>/PREFLIGHT.md`. Assert each `targets[i].installed` includes `"PREFLIGHT.md"`.
- [ ] 3.2 Test case: `--agent claude` single-target. Assert only `<root>/.claude/skills/PREFLIGHT.md` exists; `<root>/.codex/skills/PREFLIGHT.md` and `<root>/.opencode/skills/PREFLIGHT.md` do NOT exist.
- [ ] 3.3 Test case: `--target /tmp/foo`. Assert `/tmp/foo/PREFLIGHT.md` exists. Assert `targets[0].agent` is `null`.
- [ ] 3.4 Test case: `--dry-run`. Pre-condition: `<target>/PREFLIGHT.md` does NOT exist on disk. Run with `--dry-run`. Assert `targets[0].installed` includes `"PREFLIGHT.md"` AND the file is still absent on disk.
- [ ] 3.5 Test case: stale `PREFLIGHT.md` overwrite. Pre-create `<target>/PREFLIGHT.md` with garbage content. Run install. Assert post-run bytes equal source.
- [ ] 3.6 Test case: non-namespaced files NOT named `PREFLIGHT.md` are untouched. Pre-create `<target>/extra-doc.md` and `<target>/notes.txt`. Run install. Assert both files exist with original bytes after.

## 4. Verification

- [ ] 4.1 `pnpm --filter @memon/cli typecheck` passes.
- [ ] 4.2 `pnpm --filter @memon/cli test` passes (all existing tests + the new ones).
- [ ] 4.3 `openspec validate skills-extract-preflight-runtime --type change` is clean.
- [ ] 4.4 Build the CLI and run a smoke test against a tmp project root: `pnpm --filter @memon/cli build && node packages/cli/dist/cli.js install-skills --project-root /tmp/preflight-runtime-smoke --agent claude --format json | jq -r '.targets[0].installed | sort | .[]'` — output SHALL include the line `PREFLIGHT.md`.
- [ ] 4.5 Smoke test: `ls /tmp/preflight-runtime-smoke/.claude/skills/PREFLIGHT.md && diff /tmp/preflight-runtime-smoke/.claude/skills/PREFLIGHT.md packages/skills/PREFLIGHT.md` — SHALL succeed (file exists; byte-equal).
- [ ] 4.6 Confirm SKILL.md files were NOT modified: `git diff packages/skills/memon-*/SKILL.md` SHALL be empty after this change.
