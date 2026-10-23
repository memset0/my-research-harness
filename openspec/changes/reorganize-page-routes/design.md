## Context

Page URLs are built in about a dozen places:
- `projectWebPath`;
- `artifact-navigation`;
- the share registry's `projectRoutePrefix` and `shareLandingPath`;
- copies in the sidebar and the Experiment card grid;
- inline suffixes in the AppBar, inbox, wiki, code-review and results cells.

They are parsed in another half dozen:
- the sidebar's active-project match;
- the share dialog's page detection;
- document-scope grants;
- route classes;
- `?share=` redemption and Host extraction in middleware;
- Markdown link resolution;
- core's Wiki delete-reference scan.

Route classes treat any unmatched path as owner-only `mutating`. Share records store both a `scope` (kind + full id) and a literal landing `path` computed at creation. Code reviews are identified by their `docs/`-relative path, and two reviews may share a date. Experiment numbers are unique at creation, but nothing enforces that afterwards. Report and Wiki ids are already the bare `R<NNNN>` and `W<NNNN>`.

The live central config already declares a Host for every Project and does not set `central.legacy_share_host`.

## Goals / Non-Goals

**Goals:**
- One client-safe module owns building, parsing and legacy mapping of project page paths. Every builder and parser listed above uses it.
- Legacy redirects never read project files, so they are fast, run before authentication and work for anonymous viewers.
- A rollback to the previous release stays safe for browsers that already followed a redirect.

**Non-Goals:**
- Changing service application URLs (`/api/content-services/…`) or API routes.
- Rewriting stored share records or links already written in project documents.
- Renaming the in-process "standalone services" layer, which central also uses. Only hostless *serving* is removed.

## Decisions

**1. App Router tree `app/[host]/[project]/…` replaces `app/h/[host]/p/[project]/…`, and `app/p/**` is deleted.**
- Static top-level segments (`api`, `login`, `manage`, `s`, `share`) take precedence over the dynamic `[host]` segment, so a Host with one of those names would be unreachable. The config loader therefore rejects them, plus `h` and `p`.
- With the `p` tree deleted and `p` reserved, `/p/project-a/…` falls into `[host]=p`. There is no such Host, so it 404s with no dedicated route.
- Alternative considered: keep the files and use Next rewrites. That was rejected because two route trees would keep both shapes alive in links.

**2. One route module (`apps/web/lib/project-routes.ts`, no `server-only` import).**
- It exports typed builders: overview, experiments, experiment, wiki, wikiPage, reports, report, journal, codeReviews, codeReview (project or Experiment scope). Each takes a `{host, project}` target and a page.
- It exports `parseProjectPath(pathname)`, which returns the target, the page kind and the number or review key.
- It exports `canonicalFromLegacy(pathname)` for the `/h/…/p/…` table and `canonicalNumberRedirect(pathname)` for padded or prefixed numbers. Both are pure.
- The middleware, the custom server's gateway, server components, client components, the share registry, document-scope and route-classes all import it. It must stay importable from the tsx-run custom server: no `server-only`, no Next imports.
- Core's `wiki/delete-references.ts` cannot import web code, and client code must not import core at runtime. So core keeps its own small parser. It is extended to the canonical forms and tested against the same table of example links.
- Alternative considered: put the module in `@memon/core`. Rejected by the client import rule.

**3. Redirects live in middleware, ahead of authentication, as 308 with `Cache-Control: no-store`.**
- One middleware step does three things:
  - maps `/h/<host>/p/<project>/…` to the canonical path;
  - normalizes padded or prefixed numbers;
  - strips the retired side-document parameters.
- It always emits a single redirect, never a chain.
- `no-store` keeps browsers from caching the permanent redirect, so `deploy.sh --rollback` to a release without canonical routes does not strand users on URLs that release cannot serve. Once this release has proven stable, a later change can drop `no-store`.
- `?share=` redemption runs after this step, so an old shared link takes two hops: 308 to the canonical URL, then 302 that sets the cookie and drops the token.

**4. Number resolution happens in the page server components.**
- `/r/<n>` and `/w/<n>` map directly to `R<NNNN>` and `W<NNNN>` (zero-padded to at least four digits).
- `/e/<n>` looks up the published Experiment catalog for ids starting with `E<NNNN>-`. Exactly one match renders it. None shows the not-found page. More than one shows a repair error naming every match.
- The resolved full id is what existing services already accept, so no backend API changes.

**5. Code reviews keep `<date>-<slug>`.** The key is the review's filename stem, which is unique within its scope. `/cr/<key>` maps to `code-review/<key>`, and `/e/<n>/cr/<key>` maps to `experiments/<resolved E id>/code-review/<key>`. No ordering rule or stored number is needed.

**6. Shares use computed canonical landings.**
- A share record's landing URL is derived when it is used.
- Document scopes use the canonical page for their kind and id.
- Project scopes map the stored `path` through `canonicalFromLegacy`, and fall back to the project root when the path is not a recognizable page.
- New records store the canonical path. The registry file is never rewritten.
- `/share/<host>/<project>/<token>` becomes a plain redirect to `/<host>/<project>?share=<token>`, so there is one redemption code path.
- Document grants compare kind plus number: an Experiment grant for `E0010-<slug>` covers `/e/10`. Run-asset ownership checks are unchanged.

**7. Retire the project-local share store with its last consumers.**
- `memon share create|list|revoke` write `<root>/.memon/shares.json`, which only the hostless `/share/<project>/<token>` landing and its `legacy_share_host` bootstrap read.
- All of these go together, along with the core `shares` exports and the legacy share migration, if nothing else imports them. The same goes for the project-scoped `/api/projects/<project>/shares` routes, central's project-share bridge and the viewer-identity path that reads `shares.json` per entry. Apply first confirms that the central registry (`/api/shares`) covers everything they served.
- The config loader rejects `central.legacy_share_host` and names the removal.
- The CLI leaf count in AGENTS.md is updated.

**8. "Host-qualified only" is checked in Web startup, not in the shared loader.**
- The CLI resolves project-only configs through the same core loader, so the hostless-Project rejection lives in the Web runtime's config entry.
- The reserved-Host and `legacy_share_host` checks go in the loader, because no role may use them.
- `config.example.yml`'s default block becomes Host-qualified mock projects with explicit `execution: {kind: local}`. Web tests move to the Host-qualified `@memon/test-utils` fixture.

## Risks / Trade-offs

- [A route or link builder is missed and still emits `/h/…`] → The redirect keeps it working. A test greps built client chunks and server sources for `"/h/"` and `` `/p/${ `` path literals outside the route module.
- [Route classes default unknown paths to owner-only, so a missed canonical pattern would lock viewers out] → route-classes tests cover every canonical page kind for an anonymous share viewer.
- [Experiment number collisions in existing projects] → Before deploy, check the live catalogs for duplicate numbers. Duplicates show a repair error rather than a wrong page.
- [Removing standalone mode breaks local mock development] → The example config and the developer's ignored `config.yml` move to a Host-qualified form in the same change, and the dev server start is verified.
- [A large test churn hides real regressions] → Update path literals first with no behavior change, then make behavior edits. Run the full suite before archive.

## Migration Plan

1. Release `v11.21.0` (MINOR, because the CLI loses its `share` leaves) with surfaces `central,cli`.
2. Deploy central with `deploy.sh <sha>`. Then update the cluster CLIs and project skills with `memon update`.
3. Verify live:
   - old `/h/…` links for every page kind 308 to the canonical page;
   - canonical pages render;
   - an old `?share=` link and `/s/<token>` still admit a viewer;
   - `/p/…` 404s.
4. Rollback is `deploy.sh --rollback`. Redirects are not cached, and the previous release still serves `/h/…`, so links keep working after a rollback.
