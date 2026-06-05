## 1. Skill file

- [x] 1.1 Create `packages/skills/memon-write-code-review/SKILL.md` with frontmatter (`name`, `description`, `argument-hint`, `license: MIT`, `metadata.author` / `metadata.version`) — model-invocable (no `disable-model-invocation`).
- [x] 1.2 Body sections: Preflight (→ `../PREFLIGHT.md`); When to use / When NOT to use; File naming + scope (the two locations + `<YYYY-MM-DD>-<slug>`, one doc per session/large change); Frontmatter contract (all keys; `reviewed`/`done` written `false`; completion derived); GitHub URL recipe (main repo + submodules, ssh→https, `/commit/<sha>` + `blob/<sha>/<path>#Lx-Ly`, path relative to owning repo); Body template (Requirement/Changes/Verification/Notes; Conventional-Commit change titles; five H4 subsections incl. "Details: None"; minimal snippets + permalinks; deep "why" + math; pseudocode labeling); change-split granularity via AskUserQuestion; "angles, not a template" philosophy; Anti-patterns; Errors table.
- [x] 1.3 Keep all prose English; embed user-facing dialogue in Chinese inside `>` quotes.

## 2. Wiring

- [x] 2.1 `packages/skills/README.md`: add a row to the "Pick the right skill" matrix and a row to the "Files written / never touches" table.
- [x] 2.2 `packages/skills/PREFLIGHT.md`: add `memon-write-code-review` to the list of preflight-using skills (update the count wording).

## 2b. Integrations

- [x] 2b.1 `memon-write-code-review` SKILL.md: post-write step that pushes `memon notify` (severity `done`, `[code-review]`-prefixed title, `--agent`/`--session`, best-effort with exit-2 handling).
- [x] 2b.2 `packages/skills/memon-drive/SKILL.md`: list `memon-write-code-review` as a sub-tool and add a step offering a code-review after a reviewable code change lands (ask once per unit; skip results-only runs).

## 3. Verify

- [x] 3.1 `openspec validate skills-add-code-review --type change --strict` clean.
- [x] 3.2 Sanity: `memon install-skills` (dry run / temp project root) discovers the new `memon-write-code-review` dir and deposits it; confirm SKILL.md frontmatter `name` resolves and the body is English.
