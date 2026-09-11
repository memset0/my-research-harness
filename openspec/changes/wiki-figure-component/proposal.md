## Why

Wiki illustrations need a stable component contract that keeps the image, visible caption, and agent-readable description together. Shared, slug-named local assets should work in both single-file and bundle wiki pages, whether drawn as SVG by an agent or supplied/authorized by the user.

## What Changes

- Register `figure@1` with YAML payload fields `slug`, `src`, `caption`, and `description`.
- Store figure images in `docs/wiki/assets/<slug>.<extension>` and serve them through the authenticated wiki asset transport for standalone and Host-qualified projects.
- Render semantic figures with visible captions and descriptive alternative text; retain descriptions in authored Markdown and text projections.
- Render SVG only as an image, never as injected executable markup; shared asset responses restrict active content.
- Extend the component-authoring skill with authorized-image and SVG authoring guidance, plus neutral rendered fixtures and focused regression tests.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `wiki-store`: Shared wiki image assets and the registered figure component contract.
- `memon-wiki-skill`: Figure authoring, asset naming, user authorization, and description integrity.

## Impact

Central registry and shared Markdown renderer, backend asset transport, wiki discovery, the component-authoring skill, and mock fixtures. No image upload UI, automatic downloader, external hotlinks, or changes to existing bundle asset semantics.
