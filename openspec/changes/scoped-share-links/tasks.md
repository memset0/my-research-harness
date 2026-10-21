## 1. Registry and API

- [x] 1.1 Add the central share registry module (schema, `0600` atomic writes under a mutex, create/list/remove/validate with constant-time token match, expiry via the existing duration parser, server-derived landing paths); verify with unit tests for create, list filter, revoke, expiry, landing-path containment and unreadable-file fail-closed
- [x] 1.2 Add owner-only `GET/POST /api/shares` and `DELETE /api/shares/<id>` (document existence check through the read services, `share_url` from the public origin) and classify them as owner-only; make the central legacy `/api/projects/<project>/shares` routes answer 410; verify with route tests
- [x] 1.3 Add the anon `/s/<token>` landing route (rate-limited, cookie dedup by token with a 32-entry cap, redirect to the stored path); verify with route and cookie tests

## 2. Authorization

- [x] 2.1 Return grants from share validation (registry first, legacy fallback), add `scopeDocuments` to the resolved identity and forward `x-memon-doc-scope`; verify with identity tests
- [x] 2.2 Implement the document-target mapper and middleware check with per-request scope injection and Run resolution; verify with middleware tests for allowed page/detail/asset/Run/log reads, denied lists, other documents, other Runs and dot-segment paths
- [x] 2.3 Let Project layouts and the session accept document-scoped viewers; verify with layout/session tests

## 3. UI

- [x] 3.1 Rework the share dialog: scope choice on document pages (page-only default), Project token list with scope column, copy and revoke, using `/api/shares`; verify with component tests
- [x] 3.2 Hide Project rails, tabs and Project-list sections for document-scoped viewers on Wiki, Report and Experiment pages; verify with component tests

## 4. Verification

- [x] 4.1 Run the touched test files, `pnpm typecheck` and Biome; after deployment issue a page link and a Project link on central, open each in a fresh cookie jar, confirm landing, allowed and denied reads, and revocation
