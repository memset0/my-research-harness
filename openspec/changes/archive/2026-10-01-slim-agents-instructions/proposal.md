## Why

The root `AGENTS.md` (symlinked as `CLAUDE.md`) has grown to ~49KB and drifted from the code: it omits `@memon/backend` and `@memon/skills`, lists wiki kinds, SSE topics, CLI subcommands and Web endpoints that no longer match the source, describes a Run README model (required H2s, `experiment:` frontmatter, `RUN_HAS_*` warnings) that the parser and the `memon-run-experiment` skill no longer follow, omits the `INTERRUPTED` Run status, points UI verification at a CSS path that only exists in dev mode, and documents a removed `components/ui.tsx` shim and browser-side SSE subscription. Agents load this file on every session, so stale facts actively mislead and its size dilutes the hard rules.

## What Changes

- Rewrite `AGENTS.md` into: hard rules, a repository map with pointers to the sources of truth, rule-form failure modes F1–F5, operator runbooks (auth, prod start/stop, UI verification), Web conventions, and repository-specific OpenSpec/Git/release requirements.
- Replace code-snapshot enumerations (CLI commands, Web endpoints, SSE topics, wiki kinds, detailed file model) with pointers to `memon --help` / `packages/cli/src/index.ts`, `apps/web/app/api/**/route.ts`, `BACKEND_EVENT_TOPICS` in `packages/core/src/backend-protocol.ts`, `packages/core/src/wiki/kinds.json`, and `openspec/specs/<name>/spec.md`.
- Correct factual drift: Run status enum includes `INTERRUPTED`; Run README has no required H2 and membership is declared only by the Experiment's `runs`; path containment is `assertWithinProjectRoots` on Web routes plus per-service containment checks in the Backend services; embedded SQLite files are an allowed central-side local store; browser pages no longer subscribe to SSE; the UI CSS check derives the stylesheet URL from served HTML so it works for dev and prod builds.
- Describe the repository as it will be after the concurrent `restore-local-gates-and-backend-cleanup` change (no Backend daemon/distribution/update modules; pre-commit hooks installed by `pnpm install`).
- Move the generic OpenSpec workflow routing text (core/expanded routing, transition policy and phase rules, development entry gate, installation-and-update commits) to a new `openspec/WORKFLOW.md`, which `AGENTS.md` requires reading before any OpenSpec or Git operation. Repository-specific rules stay in `AGENTS.md` without loss.
- Keep the symlink `CLAUDE.md -> AGENTS.md` unchanged.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

None. `AGENTS.md` is contributor/agent documentation and is not governed by a canonical spec's behavior. The only spec-level references to it are preserved as-is: `fs-migration-guide-authoring` requires the file to name `openspec/specs/fs-migration-guide-authoring/spec.md` (kept), and `git-status` cites the F4 rule by label (kept). The change therefore sets `skip_specs: true`.

## Impact

- `AGENTS.md` (rewritten; `CLAUDE.md` symlink untouched).
- New `openspec/WORKFLOW.md`.
- No code, spec, skill, API or on-disk format change; no release surface change.
