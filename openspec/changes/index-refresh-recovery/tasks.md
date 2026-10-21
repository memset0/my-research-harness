## 1. Core catalogs

- [x] 1.1 Split Wiki and Report catalog construction into builders returning `{ entries, invalid }` (all problems collected, duplicate IDs reported) and keep `publishWikiCatalog` / `publishReportCatalog` throwing one aggregated error; verify with `project-catalogs` unit tests for multiple invalid Reports (flat and categorized) and duplicate IDs
- [x] 1.2 Make `rebuildIndex` build snapshot and all catalog entries before writing, return an `invalid` status with every issue and write nothing on refusal, and count Reports; verify with a rebuild test asserting the snapshot and catalogs are unchanged after a refusal and a Report count after success
- [x] 1.3 Add a catalog check that diffs built entries against the published catalogs (missing, extra, changed, unreadable, invalid) without writing; verify with unit tests for current, missing-entry and missing-catalog cases

## 2. CLI

- [x] 2.1 `memon refresh`: report `published` and Report counts; on refusal emit every invalid document and exit non-zero; clarify targeted vs plain refresh in help; verify with `refresh.test.ts`
- [x] 2.2 Add `memon refresh --check` (read-only, exit 0 only when current, not combinable with Experiment targets); verify with `refresh.test.ts` for stale then current

## 3. Skills

- [x] 3.1 Write the index procedure in `packages/skills/PREFLIGHT.md` and point to it from `memon-research`, `memon-wiki` (maintenance reference) and `memon-write-report` at their document-writing steps; verify the skills build check (`pnpm --filter @memon/skills build`) passes and the text covers every point of the spec

## 4. Central

- [x] 4.1 Add the rule-gated shallow probe and `RESOURCE_NOT_REFRESHED` → 404 `NOT_REFRESHED` mapping, used by Experiment, Wiki and Report detail lookups and the content gateway; verify with backend tests for hit, well-formed miss and malformed ID (no listing)
- [x] 4.2 Show "Not refreshed" in the Experiment, Wiki and Report detail panes when the API error code is `NOT_REFRESHED`; verify with component tests

## 5. Verification

- [ ] 5.1 Run the touched test files, `pnpm typecheck` and Biome on touched files; after deployment open an unpublished, a missing and a malformed ID on central and confirm the three responses
