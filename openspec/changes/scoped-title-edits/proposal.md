## Why

Projects served through a File Agent are configured read-only in central, so the owner cannot fix even a Report or Wiki title from the website. Opening full read-write access would let central rewrite any project file. The owner wants a first, tightly bounded kind of on-disk edit: renaming the display title of a Report or Wiki page (never its slug, ID or path).

## What Changes

- The File Agent accepts a third grant value, `read-edit`. A `read-edit` principal may read like `read`, and may only `replace` an existing file under a `match` precondition, at a path under `docs/reports/` or `docs/wiki/` whose name is `manifest.json` or ends in `.md`, or at `.memon/index/reports.json` / `.memon/index/wiki.json`. The replaced bytes and the new bytes may differ only within one span of at most 4096 bytes. Everything else is refused with `FORBIDDEN`. The agent advertises capability `scoped-edits-v1`.
- Central Project entries accept `allowed_edits: [title]`. A `read_only: true` Project with it permits only the title edit; every other write stays refused.
- Central rewrites only the title: the `title` string of a manifest, the `title` frontmatter value of a Markdown document (added when absent), or the first H1 of a Markdown Report without frontmatter. All other bytes stay unchanged. The published `reports.json` / `wiki.json` catalog entry gets the new title and file mtime; the derived snapshot is left for the next `memon refresh`.
- Owner API `POST /api/reports/<id>/title` and `POST /api/wiki/<id>/title` with `{ "title": "…" }` (1–512 characters after trimming, no line breaks). Report and Wiki page headers offer Rename to the owner.
- Title edits record no journal receipt (the receipt would be an out-of-scope write on a scoped Project).

## Capabilities

### New Capabilities
- `document-title-edit`: scoped File Agent edits, the central edit allowance, the title rewrite rules, the API and the Rename action.

### Modified Capabilities

## Impact

`packages/file-agent` (grant parsing, mutate authorization, scoped edit checks; installed separately), `packages/core` (config `allowed_edits`, title rewrite helpers), `packages/backend` (document service title methods), `apps/web` (routes, API client, header Rename dialog), `config.example.yml`, `packages/file-agent/README.md`, AGENTS.md config key list. Existing grants, read-write behavior and read-only Projects without `allowed_edits` are unchanged. New feature without a filesystem migration: MINOR release (11.22.0); the agent must be upgraded and granted `read-edit` per Project to use it.
