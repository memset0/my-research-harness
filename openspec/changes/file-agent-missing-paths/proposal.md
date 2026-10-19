## Why

An experiment can retain links to deleted Run documents. Native access treats those paths as missing, but an existing protocol-v1 agent returns `IO_ERROR` from path resolution, causing the entire experiment list to fail.

## What Changes

- Confirm a failed agent resolution with a bounded metadata request and expose a filesystem missing error only when the source confirms absence.
- Preserve authorization, containment, availability and genuine I/O errors.
- Cover missing paths and error preservation against the existing agent without changing its wire protocol or research files.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `project-file-store`: preserve the distinction between confirmed missing paths and access failures during agent path resolution.

## Impact

The file-protocol client and focused integration tests change. Existing agents remain compatible; no filesystem migration or agent upgrade is required. Site deployments need the corrected client.
