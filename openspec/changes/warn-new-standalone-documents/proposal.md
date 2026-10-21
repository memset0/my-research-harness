## Why

Agents still create new Reports as standalone `R<NNNN>-<slug>.md` files. The skills now forbid it, but nothing tells the agent at the moment it publishes. Warning on every standalone file would be noise in projects that still hold legacy standalone documents.

## What Changes

- `memon refresh` reports a warning for each standalone (flat) Markdown Report or Wiki page whose ID is not in the previously published catalog, naming the folder form to use instead. Documents already published, and every document on a project's first publication, are not warned about. The warnings do not block publication and do not change the exit code.

## Capabilities

### New Capabilities

### Modified Capabilities
- `derived-index`: refresh warns about newly added standalone Report and Wiki files.

## Impact

`packages/core` (catalog comparison in rebuild), `packages/cli` (refresh diagnostics) and tests. MINOR release; update cluster CLIs.
