## 1. Route module and config

- [x] 1.1 Add `apps/web/lib/project-routes.ts`. It holds the canonical builders, `parseProjectPath`, `canonicalFromLegacy` and `canonicalNumberRedirect`, plus a table-driven test covering every row of the page-routes tables, padded and prefixed numbers, unknown legacy subpaths and hostless paths. Verify with `lib/project-routes.test.ts`; `lib/server/layering.test.ts` must also pass, because the module is importable without `server-only`.
- [x] 1.2 Config loader changes:
  - reject reserved Host ids (`api`, `h`, `login`, `manage`, `p`, `s`, `share`);
  - reject `central.legacy_share_host` with a removal message;
  - make the Web runtime refuse hostless Projects.
  Verify with core config tests, plus a web runtime test that a hostless config fails startup with the `host:` message.
- [x] 1.3 Convert `config.example.yml` and the shared web test fixtures to Host-qualified mock projects. Update the developer's ignored `config.yml` to match. Verify the example parses in the config test, and a prod start serves `/<host>/project-a`.

## 2. Pages and redirects

- [x] 2.1 Move the page tree from `app/h/[host]/p/[project]` to `app/[host]/[project]`:
  - add `experiments`, `e/[n]`, `w/[n]`, `r/[n]`, `cr/[key]` and `e/[n]/cr/[key]`;
  - resolve numbers (Experiment catalog lookup, duplicate-number repair error, not-found);
  - delete `app/h/**` and `app/p/**`.
  Verify with page tests for each kind, duplicate Experiment numbers and missing numbers.
- [x] 2.2 Add one middleware redirect step ahead of authentication. It covers the legacy `/h/…/p/…` mapping, padded or prefixed numbers and retired side-document parameters, and emits a single 308 with `Cache-Control: no-store` that keeps the query. Verify with `middleware.test.ts` cases for each legacy row, a combined legacy+side-parameter URL, an anonymous request and `?share=` preservation.
- [x] 2.3 Point every page-URL builder at the route module and remove the duplicates:
  - `projectWebPath`, `artifact-navigation`, sidebar, card grid, AppBar tabs and active matching;
  - inbox, wiki-shell, code-review list and links, results-table run links, journal links, project footer;
  - `app/page.tsx`, route prewarm.
  Verify with the touched component tests, plus a source test that no file outside the route module builds `/h/` or `` `/p/${ `` page paths.
- [x] 2.4 Make Markdown link resolution and core's Wiki delete-reference scan accept canonical, `/h/…/p/…` and hostless document links. Verify with `artifact-links.test.ts` and `delete-references.test.ts` using one shared example table.

## 3. Auth and shares

- [x] 3.1 Route classes, project-scope extraction, `?share=` redemption, Host extraction and document-scope grants should recognize canonical routes, with Experiment grants matched by number. Verify with `route-classes.test.ts`, `document-scope.test.ts` and `middleware-document-share.test.ts`, run as an anonymous viewer against every canonical page kind.
- [x] 3.2 Share registry and API:
  - compute canonical landings from scope;
  - map stored project-scope paths;
  - store canonical paths for new records;
  - generate canonical `?share=` URLs;
  - make `/s/<token>` land on the canonical page;
  - make `/share/<host>/<project>/<token>` redirect to `/<host>/<project>?share=<token>`;
  - update the share dialog's page detection.
  Verify with `share-registry.test.ts`, `app/s/[token]/route.test.ts`, the share route tests and `manage-shares-dialog.test.tsx`, including a record created with an old `/h/…` path.
- [x] 3.3 Retire the project-local share store:
  - the `memon share` leaves;
  - core `shares` exports;
  - `/share/<project>/<token>`;
  - `/api/projects/<project>/shares`;
  - the project-share bridge and identity read path, once confirmed unused.
  Then update the AGENTS.md CLI leaf count. Verify with the CLI help snapshot/tests, a typecheck that no import remains, and `/share/project-a/<token>` returning 404.

## 4. Tests, docs and verification

- [x] 4.1 Update the remaining test files and AGENTS.md runbook examples that hard-code `/h/…/p/…` or `/p/…` page paths. Verify by running the touched web, core and CLI test files, `pnpm typecheck` and Biome on the changed files.
- [ ] 4.2 Before deployment, check the live project catalogs for duplicate Experiment numbers and report any. After deployment, verify:
  - an old `/h/…` URL for every page kind 308s to its canonical page;
  - canonical pages render, checked with headless Chrome by clicking an Experiment's Report link;
  - an old `?share=` link and `/s/<token>` still admit an anonymous viewer;
  - `/p/…` and `/share/<project>/<token>` return 404.
