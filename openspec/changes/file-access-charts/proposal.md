## Why

The File access page reports only window totals, so the owner cannot see which project is generating source traffic or how latency moved over the last minutes when a source is slow.

## What Changes

- The metrics snapshot adds a per-storage-group timeline (physical operations, errors and cache hits per 5 s bucket over the selected window) and the most recent 300 physical operations with their execution and queue times.
- `GET`/`PUT /api/file-access` add `storageGroupProjects`, naming each storage group by the projects (`host/project`) that read through it.
- The page shows the Operations card first, with two charts: source operations per project over time, and the latency of recent operations (log scale), both colored per project.

## Capabilities

### New Capabilities

### Modified Capabilities
- `file-access-settings`: operations are charted per project over time and per recent operation.

## Impact

`packages/core/src/project-file-store/{metrics,contract,reporting,index}.ts`, `apps/web/app/api/file-access/route.ts`, `apps/web/lib/file-access-api.ts`, `apps/web/components/file-access-{charts,settings-panel}.tsx`. Central-only: PATCH release.
