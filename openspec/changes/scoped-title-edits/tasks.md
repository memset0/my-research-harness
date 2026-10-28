## 1. File Agent

- [x] 1.1 Accept the `read-edit` grant, authorize it for scoped mutations, enforce operation, path and 4096-byte span limits, advertise `scoped-edits-v1`
- [x] 1.2 Go tests: allowed title replacement; refused create, delete, rename, out-of-scope path and oversize span; `read` still refused
- [x] 1.3 README: grant values and a `read-edit` example

## 2. Core and backend

- [x] 2.1 Config `allowed_edits: [title]` (schema, load, example config, AGENTS.md key list)
- [x] 2.2 Title rewrite helpers for manifests, frontmatter and H1, plus a catalog entry patch keeping other bytes; unit tests
- [x] 2.3 Document service `setReportTitle` / `setWikiTitle` without journal receipts; scoped write context enabling only these methods on allowed read-only Projects

## 3. Web

- [x] 3.1 Routes `POST /api/reports/[id]/title` and `/api/wiki/[id]/title` with error mapping; API client functions
- [x] 3.2 Header Rename action and dialog for the owner; invalidate document and list queries
- [x] 3.3 Tests for routes and the Rename dialog

## 4. Verification

- [x] 4.1 Typecheck, Biome, Go tests and the touched test files
- [ ] 4.2 Rendered check of the Rename flow on a local project
