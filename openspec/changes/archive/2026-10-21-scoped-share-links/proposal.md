## Why

Sharing only works per Project, and on a central instance it does not work at all: create and list are routed to a retired Backend Host registry and fail with "Host is not configured", and no provider manages the per-project share files. Owners want to share one Experiment, Report or Wiki page, choose whether a link opens only that page or the whole Project, land the recipient on the page it was issued from, see what each issued token can reach, and revoke tokens, all managed on the central side.

## What Changes

- A central share registry (`shares.json` beside the instance config, owner-only file permissions) holds every newly issued token: Host-qualified Project, scope (`project`, or one `experiment` / `wiki` / `report` document), landing path, label, creation and expiry. Revocation deletes the record. Project-file shares created earlier stay valid for their links but are not managed here.
- Owner API `/api/shares`: list (optionally for one Project), create, revoke. Creation derives a safe landing path from the scope; the response carries the share URL `/s/<token>`.
- `/s/<token>` validates the token, adds it to the viewer cookie (deduplicated by token, bounded) and redirects to the landing path.
- Viewer authorization gains document scope: a document-scoped token admits only that document's page and the reads it needs (its detail, assets, backlinks; for an Experiment also its README, results, Runs, Run files and logs under its own run directory). Project lists, other documents, multi-Project reads and everything else are denied. Project-scoped tokens behave as before.
- The share entry in the app bar issues a link for the current page with a "This page only" / "Whole project" choice (page-only by default on document pages), lists this Project's tokens with their scope, and revokes them. Document-scoped viewers see the shared page without Project rails or tabs.
- **BREAKING (central only):** central no longer reads or writes `.memon/shares.json` for new shares; the central `/api/projects/<project>/shares` routes answer 410 and point to `/api/shares`.

## Capabilities

### New Capabilities

### Modified Capabilities
- `project-share`: central registry, scoped tokens, landing route, management API and UI, cookie dedup by token.
- `auth-system`: document-scoped viewer authorization.

## Impact

`apps/web` (registry module, `/api/shares`, `/s/[token]`, middleware and identity, project layouts, share dialog, viewer UI), `packages/core` only if shared schemas are needed. Central-only: PATCH release. CLI `memon share` (project files, standalone) is unchanged.
