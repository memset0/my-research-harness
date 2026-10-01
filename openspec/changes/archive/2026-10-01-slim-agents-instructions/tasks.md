## 1. Extract generic workflow

- [x] 1.1 Create `openspec/WORKFLOW.md` carrying the generic Core/Expanded workflow routing, Lifecycle orchestration (transition policy, propose/apply/archive phases), Development entry gate, and Installation-and-updates rules from the old `AGENTS.md`; verify by diffing each moved rule against the old text (`git show HEAD:AGENTS.md`) so none is lost.

## 2. Rewrite AGENTS.md

- [x] 2.1 Write the hard-rules section (polling, local-offset timestamps, uppercase status enums incl. `INTERRUPTED`, path containment as actually implemented, mtime+hash locks, LOCAL.md rules, skills language/location, client-side core imports, shadcn wrapper pattern, embedded SQLite exception); verify each fact by grep against the cited source file.
- [x] 2.2 Write the repository map and file-model skeleton with pointers (CLI help/index, API routes, `BACKEND_EVENT_TOPICS`, `kinds.json`, specs) and the corrected Run README model; verify each pointer path exists.
- [x] 2.3 Rewrite F1–F5 in rule form with the dev/prod-safe CSS verification; verify the CSS-token command against the running server.
- [x] 2.4 Write the runbooks (auth, prod start/stop, UI verification) and Web conventions (no shim, no browser SSE, query-key description); verify the referenced cookies, scripts and helpers by grep.
- [x] 2.5 Carry over every repository-specific OpenSpec/Git/release/testing/deployment/tasks-scope/instruction-file rule plus the `fs-migration-guide-authoring` pointer and a MUST-read reference to `openspec/WORKFLOW.md`; verify with a rule-by-rule comparison against the old file and `grep -n fs-migration-guide-authoring/spec.md AGENTS.md`.

## 3. Verification

- [x] 3.1 Confirm `CLAUDE.md` is still a symlink to `AGENTS.md`, `AGENTS.md` size is in the 15–20KB target (or justified), no operator-specific hosts/paths/project names appear in the changed files, and `openspec validate slim-agents-instructions --type change` passes.
