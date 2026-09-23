## ADDED Requirements

### Requirement: `install-skills` refuses the harness checkout

`memon install-skills` SHALL exit 2 with `BAD_REQUEST`, before writing anything, when the resolved project root is a memon harness checkout, recognized by `packages/skills/package.json` declaring the package name `@memon/skills`. The message SHALL state that bundled skills live in `packages/skills/` and are installed into research projects.

#### Scenario: Run inside the harness checkout
- **WHEN** the operator runs `memon --project-root <harness checkout> install-skills`
- **THEN** the command exits 2 and no agent skill directory under the checkout changes

#### Scenario: Ordinary project
- **WHEN** the project root has no `packages/skills/package.json` naming `@memon/skills`
- **THEN** installation proceeds as before
