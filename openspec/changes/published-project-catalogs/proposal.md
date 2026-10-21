## Why

Remote lists and detail lookups still rediscover directories behind long-lived file caches. Newly published content can remain missing, and restarting can restore obsolete observations. Source-published catalogs make discovery explicit and let central discard its disk cache.

## What Changes

- Publish ignored, readable Experiment, Wiki and Report catalogs under `.memon/index/` through refresh and relevant lifecycle writes.
- Use catalog summaries and canonical document paths for FS11 lists and detail lookup; missing or invalid catalogs require explicit refresh instead of a website scan.
- Remove central project-file dump persistence and redundant long-lived summary reuse. Keep bounded, on-demand memory observations for at most 30 seconds; manual refresh revalidates.
- Accept legacy disk-cache configuration as deprecated memory-only input without reading or writing old dumps; preserve transport containment, authorization, locking and service forwarding.
- Keep legacy project readers, research source files, user preferences and tracked Experiment results intact. Update concise author guidance and settings to describe the new policy.

## Capabilities

### New Capabilities
- `project-catalogs`: Source-published per-kind inventories and consistent list/detail lookup.

### Modified Capabilities
- `project-file-store`: Memory-only short-lived demand caching without startup restoration.
- `file-access-settings`: Expose the effective short memory policy and remove retired disk-cache controls.

## Impact

Core publication and transport cache, backend inventory/detail reads, CLI refresh and lifecycle publishing, central settings and browser freshness, bundled skills. Release 11.13.0; FS convention remains 11. Catalogs are disposable derived files, and upgrading requires an explicit refresh of existing FS11 projects without research-data migration.
