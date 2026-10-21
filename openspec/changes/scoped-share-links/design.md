## Context

Viewer access today: a signed `memon-shares` cookie lists `{host?, project, token}` entries; middleware re-validates every entry on every request through a `ShareValidator` (boolean), and grants `read`-class routes whose resolved Project is in scope. Handlers enforce scope again from `x-memon-scope` / `x-memon-host-scope` headers, and the server-injected session tells the UI the viewer's Project scopes. Central share management is proxied to a retired Host registry (500), and validation of host-qualified entries goes through that registry or a direct Project's own `.memon/shares.json`.

## Goals / Non-Goals

**Goals:** central-owned tokens for every configured Project (including read-only and File-Agent Projects); document scope; landing on the issued page; owner list with scope and revoke.

**Non-Goals:** changing CLI `memon share` or the standalone project-file store; viewer writes; sharing live services; per-viewer identities or audit beyond the record.

## Decisions

- **Registry file beside the instance config.** `shares.json` in the instance config directory, `0600`, written by temp file + rename under an in-process mutex, read on every validation (small file; no positive caching, so revocation is immediate). JSON rather than SQLite keeps it inspectable and matches the existing record shape; volume is tiny.
- **Validator returns a grant.** `ShareValidator.validate` returns `false`, `true` (Project grant, legacy) or `{ document: {kind, id} }`. The registry is consulted first; legacy project-file / registry validation remains the fallback for old links and yields Project grants. `ResolvedIdentity` gains `scopeDocuments`; Project-level `scopeProjects` / `scopeProjectRefs` keep only Project grants.
- **Document targeting in middleware.** A pure function maps a request to its document target: page routes (`/h/<host>/p/<project>/{wiki/<W>,reports/<R>,e/<E>}` and the `/p/` forms), `/api/wiki/<W>`, `/api/wiki/backlinks/<id>`, `/api/{wiki,report}-assets/<project>/<id>/…`, `/api/reports/<R>`, `/api/experiments/<E>[/readme|/results]`, and path-carrying reads (`/api/doc-assets/<project>/<path>`, `/api/readme?resource=`, `/api/log*?resource=`) whose normalized path must lie under `docs/experiments/<E>/` or `logs/<E-prefix>/`. `/api/runs/<id>[/files]` resolves the Run's resource through the read service and applies the same `logs/<E-prefix>/` rule. Anything unmapped is denied (fail closed). `multi` routes keep filtering by Project grants only, so a document-only Project never appears there.
- **Both entry points enforce it.** Host-qualified backend API reads bypass the Next middleware and go through the custom-server central gateway, so the gateway uses the same registry-first validator and the same document check (Runs resolved by an in-process owner read through the direct runtime) and grants the viewer actor exactly that Project for that request. Document existence checks at creation also read through the direct runtime for Host-qualified Projects.
- **Per-request scope injection.** When a request passes through a document grant, middleware adds that `{host, project}` to the forwarded scope headers for this request only, and forwards `x-memon-doc-scope` (all document grants) so layouts and the session can render the restricted UI. Project layouts accept a viewer whose request carries the Project in scope.
- **Landing path is server-derived.** Document scope → canonical page path; Project scope → client-supplied current path only if it lies under the Project prefix and has no dot-segments, else Project root. `/s/<token>` redirects only to the stored path, never to a request parameter.
- **Cookie dedup by token, cap 32.** Several page links of one Project coexist; the oldest entries drop beyond the cap.
- **Central legacy routes.** `/api/projects/<project>/shares[/<id>]` in central mode answer 410 with a pointer to `/api/shares`; standalone mode is unchanged.

## Risks / Trade-offs

- [Run access resolution adds a read per `/api/runs/<id>` request for document viewers] → only for document-only viewers, served by the short-lived read reuse.
- [FS9/FS10 Runs outside `logs/E<NNNN>/` are not reachable through an Experiment share] → fail-closed; owners can issue a Project share for legacy layouts.
- [Tokens are stored in plain text in the registry] → same as the previous project files; the file is owner-only and outside any project, and plain tokens let the owner copy links again.

## Migration Plan

Central-only PATCH release. Existing project-file links keep working; owners re-issue links from the new entry when they want document scope or central revocation.
