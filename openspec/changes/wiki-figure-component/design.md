## Context

Existing components use pinned fenced blocks and central-only descriptors/renderers. Existing wiki asset transport serves only W-id bundles; single-file pages have no asset base. See proposal.md for motivation.

## Goals / Non-Goals

Support one local image, visible caption, and text description per figure across wiki formats. Preserve bundle transport, unrelated Markdown, and review semantics. No upload UI, network downloader, asset CRUD CLI, automatic captioning, zoom viewer, or inline SVG execution.

## Decisions

- Add a central figure@1 descriptor with strict YAML validation, registry examples, and lossless fenced Markdown projection. A required slug determines the allowed basename in src; the path is relative to the wiki root, not the page.
- Pass ProjectTarget through the shared component renderer. Figure constructs the existing wiki asset URL using the reserved shared selector, retaining host/project query parameters. Existing components continue using their existing assetBase.
- Extend resolveWikiAsset and backend route parsing for shared. Serve only one slug-named supported image in docs/wiki/assets using existing lexical/realpath containment and byte streaming. Mark these resources with a restrictive CSP propagated by both standalone and backend responses. Do not weaken W-id bundle semantics.
- Central's response-header filter retains only the exact fixed image CSP, not arbitrary Backend CSP values or reporting endpoints; both direct and proxied Host paths use this filter.
- Exclude the assets directory in discovery. Do not scan all shared assets on every page fetch or embed file contents in component payloads.
- Render native figure/img/figcaption with theme-aware caption typography, description as alt text, and a readable load-failure fallback. React escapes all authored caption/description text.
- Update only the canonical component-authoring skill; other skills continue routing there without duplicating the field schema. Use neutral self-authored SVG and a tiny raster fixture for tests.

## Risks / Trade-offs

- SVG can carry active content → image-only rendering, shared-resource CSP, nosniff, and self-contained authoring rules; authorized images are not permission to execute scripts.
- New shared selector needs updated Backends → rebuild the backend alongside central; older Backends return a visible image failure rather than changing existing bundle behavior.
- Central lint cannot synchronously probe remote shared files → payload lint validates paths/schema; authors check local existence and browser rendering catches missing resources.
- Shared assets may outlive page deletion → no automatic deletion or garbage collection in this change, avoiding removal of another page's image.

## Validation

Run focused registry/renderer, discovery, backend resource/route, standalone route, and skill tests plus affected typechecks. Build affected packages and inspect a neutral fixture through the actual browser renderer and shared asset endpoint, including desktop/mobile, SVG/raster, caption/alt, and load failure. No full suite.
