## Why

Page URLs have grown three prefixes (`/h/<host>/p/<project>`, hostless `/p/<project>`, legacy share paths), padded and slugged ids (`/e/E0010-some-slug`, `/reports/R0010`) and nested review paths (`/code-review/experiments/E0005-…/code-review/<date>-<slug>`). Links are long, hard to type and hard to share, and every builder and parser re-implements the prefix. The side workspace that added more URL state is already gone, so this is the moment to fix one short, host-qualified route table and redirect everything older to it.

## What Changes

- **BREAKING** Canonical project pages move to `/<host>/<project>/…` with unpadded numbers and no slugs:
  - `/<host>/<project>` (Experiment overview) and `/<host>/<project>/experiments` (same content);
  - `/e/<n>`, `/wiki`, `/w/<n>`, `/reports`, `/r/<n>`, `/journal`, `/code-review`;
  - `/cr/<date>-<slug>` (project review) and `/e/<n>/cr/<date>-<slug>` (Experiment review).
- Numbers are strict: a padded or prefixed number (`/r/0010`, `/r/R0010`) 308-redirects to `/r/10`. An Experiment number held by two directories is a repair error, never a guess.
- Every `/h/<host>/p/<project>/…` URL 308-redirects to its canonical equivalent, keeping all query parameters. This covers bookmarks, shared links and links written inside project documents.
- Markdown links written in the old forms keep resolving to artifacts.
- **BREAKING** Hostless project URLs `/p/<project>/…` are removed (404), including the legacy Run paths `/p/<project>/r/<run>` and `/p/<project>/experiments/<run>`.
- **BREAKING** Standalone (hostless) Web mode is removed. Every Project served by the Web app declares a `host:`. The bundled example and the development config serve the mock projects under a Host. CLI project-root commands are unaffected.
- Host ids that would shadow top-level routes (`api`, `h`, `login`, `manage`, `p`, `s`, `share`) are rejected by the config loader.
- Sharing has one entry: a page URL plus `?share=<token>`.
  - `/s/<token>` keeps working: it redeems and lands on the token's page at its canonical URL.
  - `/share/<host>/<project>/<token>` redirects to `/<host>/<project>?share=<token>`.
  - Stored share records with old-format landing paths are mapped to canonical URLs.
- **BREAKING** The hostless share landing `/share/<project>/<token>`, `central.legacy_share_host`, the per-project `.memon/shares.json` store and the `memon share create|list|revoke` CLI commands are retired. Shares are created in the Web share dialog only.
- `?run=`, `?expanded=1` and service URLs under `/api/content-services/…` are unchanged.

## Capabilities

### New Capabilities
- `page-routes`: the canonical page route table, number parsing, legacy-URL redirects, reserved Host ids and the rule that the Web app serves only Host-qualified Projects.

### Modified Capabilities
- `web-dashboard`: Host-qualified navigation, Experiment links, code-review navigation; legacy Run-path redirects removed.
- `web-layout`: AppBar tabs and active-route matching use canonical routes; the "existing routes unchanged" and standalone-navigation guarantees are removed.
- `project-share`: share URLs and landings use canonical page URLs; the hostless landing and CLI share commands are removed.
- `memon-cli`: the `memon share` subcommand family is removed.
- `auth-system`: route classes, anon routes and project-scope extraction recognize canonical routes; document grants match Experiments by number.
- `host-qualified-project-identity`: legacy project-only navigation is removed.
- `wiki-viewer`: Wiki routes.
- `code-review-viewer`: review list and detail routes.
- `dev-route-prewarm`: the prewarmer warms canonical routes.

## Impact

- **Web app** (`apps/web`):
  - the route tree moves from `app/h/[host]/p/[project]` to `app/[host]/[project]`, and `app/p/**` is deleted;
  - middleware gets the legacy redirect;
  - link builders and parsers move to one module: `projectWebPath`, `artifact-navigation`, the share registry landing path, the sidebar and card-grid copies, the inline builders, `manage-shares-dialog`, `document-scope`, `route-classes`, `artifact-links`;
  - share routes, `app/page.tsx` and route prewarm are updated.
- **Core:**
  - config loading rejects hostless Web projects, reserved Host ids and `legacy_share_host`;
  - the per-project share store and its exports are retired;
  - `wiki/delete-references.ts` recognizes canonical page links.
- **CLI:** the `share` leaves are removed (MINOR release; cluster CLIs updated by `memon update`).
- **Tests:** roughly 38 test files hard-code old paths.
- **Docs:** `config.example.yml` and the AGENTS.md runbook examples are updated, and the CLI leaf count changes.
- **Deployment:** the live central config already declares Hosts. The shares registry is read compatibly and not rewritten.
- **Other changes:** the active `run-scheduler` change also modifies "Top AppBar with project view tabs" with `/p/…` URLs and a scheduler page. It must be rebased onto the canonical routes (`/<host>/<project>/scheduler`) before it is archived.
