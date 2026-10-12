## Why

Experiment lifecycle and execution progress are now separate, but the list mixes current work with paused work and combines archived and retired directions. The sidebar shows only identifiers, making status hard to use for navigation.

## What Changes

- Group the list and sidebar by stored lifecycle, with counts, distinct status cues and consistent ordering. Keep RUNNING and COMPLETED as progress within ACTIVE.
- Add list search and direct lifecycle/progress filters; separate archived and retired collapsible groups. Automatically reveal matching filtered items and the current sidebar destination.
- Let status-aware navigation share the existing Experiment summary query on demand, retaining identity inventory fallback for unavailable metadata and existing project read-intent gates.
- Preserve legacy status labels and archive semantics without inferring a modern scientific lifecycle. Do not reclassify research data.

## Capabilities

### New Capabilities
- `experiment-status-navigation`: Grouped, searchable Experiment navigation with lifecycle/progress distinction and accessible sidebar rows.

### Modified Capabilities
- `run-discovery`: Permit explicitly status-aware navigation to hydrate summaries while retaining lightweight inventories for identity-only consumers and fallback.

## Impact

Central Web components, shared browser-safe presentation helpers and focused UI tests. No new API, backend traversal, dependency, filesystem convention or research-data migration. This refines list/sidebar presentation of the active experiment-research-versions change; lifecycle computation remains unchanged.
