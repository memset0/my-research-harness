## 1. Command surface

- [x] 1.1 Split shared CLI runtime and normal/tools/legacy registrations; verify actual leaf lists are 6/12/14, removed spellings fail without writes, and retained entrypoints preserve exit behavior.
- [x] 1.2 Remove unused retired adapters and update invocation classification; verify no orphan registrations/imports and focused legacy/tool regressions pass.

## 2. Complete the small workflow

- [x] 2.1 Unify inventory, Experiment, Run, Wiki, section and Results reads through show; verify published-index reads, targeted historical access, filters, diagnostics and contained paths.
- [x] 2.2 Initialize only fresh research on first Experiment creation and retain publication validation; verify fresh create/update/refresh lifecycle, prepared parameter exports, malformed/legacy refusal and publication failures.

## 3. Distribution and verification

- [x] 3.1 Install/update all three entrypoints and document command replacements; verify installer/updater tests, CLI help and the seven existing Skill roles remain intact.
- [x] 3.2 Run focused regression tests, root typecheck, CLI build, formatting and OpenSpec validation; record actual results and align artifacts with implemented behavior.

Verification: 173 focused CLI cases passed across command-surface, lightweight-project-flow,
show, refresh, experiment-results, experiment-lightweight, experiment-research,
experiment-schema, experiment-document, run-metadata, run-result, derived-index,
lifecycle-v4-cli, wiki, install-skills, update, invocation and discovery-options.
Root `pnpm typecheck`, CLI build, changed-file Biome checks and strict change validation passed.
The full workspace test suite was not run. No central runtime or research data was changed.
The seven Skill files and shared preflight remain frozen; README supplies the current CLI
replacement table. No Skill consolidation or reference-only correction is claimed.
