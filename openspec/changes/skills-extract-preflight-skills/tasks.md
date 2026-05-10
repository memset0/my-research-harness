## 1. Replace the preflight section in each SKILL.md

The pointer body to insert into each file (5 source lines: heading + blank + 3 prose lines):

```
## Preflight — FS convention version

Run `memon fs-version check --project-root . --format json` as the first
step. If `status !== "match"`, STOP and follow the branch protocol in
`../PREFLIGHT.md` (covers `match` / `behind` / `uninitialised` / `ahead`).
```

Replace lines spanning from `## Preflight — FS convention version` through (and including) the closing parenthetical "migration runtime and reads `.memon/version.json` directly.)" — verify by reading current line ranges first; the section block is the same content in all 7 files but at different line numbers.

- [ ] 1.1 Replace in `packages/skills/memon-write-script/SKILL.md`.
- [ ] 1.2 Replace in `packages/skills/memon-run-experiment/SKILL.md`.
- [ ] 1.3 Replace in `packages/skills/memon-append-journal/SKILL.md`.
- [ ] 1.4 Replace in `packages/skills/memon-append-warning/SKILL.md`.
- [ ] 1.5 Replace in `packages/skills/memon-digest-journal/SKILL.md`.
- [ ] 1.6 Replace in `packages/skills/memon-write-report/SKILL.md`.
- [ ] 1.7 Replace in `packages/skills/memon-propose/SKILL.md`.
- [ ] 1.8 Verify `packages/skills/memon-migrate-fs/SKILL.md` is NOT modified (no inline preflight section to begin with): `git diff packages/skills/memon-migrate-fs/SKILL.md` SHALL be empty.

## 2. Verify byte-equality across the 7 files

- [ ] 2.1 Extract the new `## Preflight — FS convention version` section body from each of the 7 modified SKILL.md files using `awk '/^## Preflight — FS convention version$/ {f=1; print; next} f && /^## / {exit} f {print}'`. Pipe each through `md5sum`. All 7 hashes SHALL be identical.

## 3. README update

- [ ] 3.1 Add one bullet to `packages/skills/README.md`'s `## Conventions baked into all skills` list, positioned as the second bullet (after `--project-root` rule, before mtime-locking rule):
  ```
  - **Preflight protocol** lives in `PREFLIGHT.md` (same dir). All
    spec-mutating skills point to it instead of duplicating the branch
    table.
  ```

## 4. Verification

- [ ] 4.1 `openspec validate skills-extract-preflight-skills --type change` — clean.
- [ ] 4.2 Smoke install: `pnpm --filter @memon/cli build && node packages/cli/dist/index.js install-skills --project-root /tmp/preflight-skills-smoke --agent claude` succeeds with exit 0.
- [ ] 4.3 `head -10 /tmp/preflight-skills-smoke/.claude/skills/memon-run-experiment/SKILL.md` — the pointer block (referencing `../PREFLIGHT.md`) SHALL appear at the top, not the old 22-line table.
- [ ] 4.4 `cat /tmp/preflight-skills-smoke/.claude/skills/PREFLIGHT.md | head -3` — the canonical doc still resolves at the sibling path.
- [ ] 4.5 `git diff packages/skills/memon-migrate-fs/SKILL.md` is empty.
- [ ] 4.6 `git diff packages/cli/` is empty (no runtime changes in this skills-side change).
