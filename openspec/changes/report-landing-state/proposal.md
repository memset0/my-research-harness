## Why

The Report inbox landing pane always shows "No reports yet. Reports are written by `memon-write-report`…" when no Report is selected, even when the project has Reports. With the picker on the right, or hidden by the reader's saved preference, the page reads as if the project had no Reports at all.

## What Changes

- With no Report selected, the landing pane shows a loading placeholder while the list loads, "Select a report from the report list to begin reading." when Reports exist, the load error when the list fails, and the `memon-write-report` empty copy only when the loaded list is genuinely empty.
- The show-reports control stays available in the landing pane whenever the picker is hidden.

## Capabilities

### New Capabilities

### Modified Capabilities
- `inbox-viewer`: the Report empty-state requirement distinguishes an unselected populated inbox from an empty one.

## Impact

`apps/web/components/inbox-shell.tsx` and its component test. Central Web only: PATCH release.
