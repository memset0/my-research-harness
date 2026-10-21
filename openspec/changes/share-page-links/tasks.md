## 1. Links

- [x] 1.1 Return `share_url` as the landing page URL with `share=<token>`; redeem a `share` query on page GETs in middleware (validate, Project containment, cookie merge, redirect without the parameter, generic invalid page); verify with middleware and API tests

## 2. Public pages

- [x] 2.1 Add the public flag to registry records and `POST /api/shares` (`public: true`, Report/Wiki scope only, idempotent), listing them with the page URL; verify with registry and route tests
- [x] 2.2 Admit anonymous (and uncovered viewer) reads of public documents in middleware and in the central gateway as document-only viewers; verify with middleware and server-auth tests including denied lists and other documents

## 3. UI

- [x] 3.1 Copy page-URL links, add "Make public" on Report/Wiki pages and list public pages distinctly in the share dialog; verify with component tests

## 4. Verification

- [ ] 4.1 Run the touched tests, `pnpm typecheck` and Biome; after deployment open a page link and a public page in a fresh cookie jar and confirm redirects, allowed and denied reads, and revocation
