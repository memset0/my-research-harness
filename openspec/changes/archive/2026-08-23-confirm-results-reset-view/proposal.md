## Why

Results `Reset view` currently executes immediately and irreversibly overwrites the complete browser/SQLite preference with defaults. It sits beside routine controls, so one accidental click can erase a carefully configured sort chain, filters, visibility, ordering, pins, overrides, and line count.

## What Changes

- Make the existing Reset view trigger open a confirmation dialog instead of mutating state.
- Explain the complete preference scope that will be cleared and that the action cannot be undone.
- Require an explicit destructive confirmation; Cancel, close, overlay dismissal, and Escape preserve all state.
- Keep Reset disabled when the current view already equals defaults.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `web-dashboard`: protect destructive Results preference reset behind confirmation.

## Impact

- `apps/web/components/experiment-results-table.tsx` and focused component tests.
- No persistence schema, API, or Results YAML changes.
