## Why

Agents can produce useful Markdown, static HTML and live applications, but the current document model requires Markdown adapters and does not expose a consistent maintenance contract. Readers need to distinguish current knowledge from time-scoped reports without imposing a research workflow or presentation template.

## What Changes

- Discover Wiki and Report folders with either README frontmatter or an HTML/service manifest, retaining legacy documents.
- Expose category, explicit freshness and report evidence time/revisions in navigation and detail views.
- Forward agent-owned services through local HTTP, SSH tunnels or the independent File Agent; never start or stop the applications.
- Add one guarded `wiki delete` command: user decides retirement; agents repair inbound references before deletion.
- Keep arbitrary static HTML and existing Markdown components usable without an adapter or required layout.
- Update concise authoring skills and prepare a per-document migration preview without applying bulk research-data changes.

## Capabilities

### New Capabilities
- `content-bundles`: Shared metadata, presentation and dynamic service forwarding.

### Modified Capabilities
- `wiki-store`: Discover manifest bundles and arbitrary topic categories while retaining old documents.
- `reports-store`: Discover classified manifest bundles and preserve time-scoped metadata.

## Impact

Core discovery/projections, Backend documents/assets, Web navigation and service gateway, independent File Agent forwarding, bundled authoring Skills. Additive FS11 support; no automatic content migration, application execution, new database or Git-review workflow.
