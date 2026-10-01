## MODIFIED Requirements

### Requirement: Skill index and preflight docs name the wiki

`packages/skills/README.md` SHALL list `memon-wiki` in the skill index and files-written table (write scope: wiki pages via `memon wiki` and direct Markdown edits; never Experiment bundles, Reports, review fields, the journal cursor, or legacy `docs/digests/` files, which only the reviewed v7 migration converts; a `digest`-kind Wiki page is an ordinary Wiki page) and SHALL describe the wiki forms next to the Report forms. `packages/skills/PREFLIGHT.md` SHALL add `docs/wiki/` to the protected-file lists.

#### Scenario: README updated
- **WHEN** a reader greps `packages/skills/README.md` for `memon-wiki`
- **THEN** it appears in both tables, and `memon-write-report` still appears
