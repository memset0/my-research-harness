## ADDED Requirements

### Requirement: Local pre-commit gates are installed and green

A development checkout SHALL install the repository's pre-commit hooks during `pnpm install`. The hook SHALL run the workspace typecheck and a Biome check of the staged files. On the main branch, `pnpm -r typecheck` and `biome check .` SHALL report zero errors. Hook installation SHALL be a silent no-op, exiting 0 with a one-line skip notice, when the install directory is not a Git checkout (for example an exported release tree) or when the hook tool is not installed (for example a CLI-only filtered install), so those installs never fail because of it.

Generated shadcn primitives under `apps/web/components/ui/` SHALL be excluded from Biome lint and format so the CLI can overwrite them verbatim. A package's tests and sources SHALL NOT import another workspace package's source files through relative paths; a cross-package parity test lives in the package that can depend on both sides.

#### Scenario: Fresh checkout installs hooks
- **WHEN** a developer runs `pnpm install` in a Git checkout
- **THEN** `.git/hooks/pre-commit` exists and invokes lefthook

#### Scenario: Exported release tree skips hook installation
- **WHEN** the install script runs in a directory without `.git`
- **THEN** it prints one skip line, exits 0 and creates no files

#### Scenario: Core typecheck stands alone
- **WHEN** `pnpm --filter @memon/core typecheck` runs
- **THEN** it succeeds without reading any file under `apps/web`
