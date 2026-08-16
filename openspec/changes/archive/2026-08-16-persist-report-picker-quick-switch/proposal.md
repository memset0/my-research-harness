## Why

The collapsible Report picker introduced by `polish-report-page` forgets its
state whenever the inbox remounts, so users who prefer a focused reading layout
must hide it repeatedly. Once hidden, the current Report identity is passive and
switching Reports requires reopening the full rail, adding friction to a common
navigation action.

## What Changes

- Persist the desktop Report picker's shown/hidden preference across Report
  navigation and reloads. Use the existing browser-first user-preference system:
  authenticated owners reconcile with their SQLite preference, while viewer and
  anonymous sessions remain browser-local.
- When the desktop Report picker is hidden, turn the current Report identity
  (`<id> <slug>`, for example `R0001 fastvideo-fa4-nvfp4-inference`) into an
  accessible shadcn Popover trigger.
- Show a compact, scrollable list of the project's Reports in the Popover, mark
  the current Report, and let a native link switch directly to another Report
  without expanding the full rail.
- Keep the expanded-state identity non-interactive and preserve the existing
  mobile Report-list Sheet as the mobile switching mechanism.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `inbox-viewer`: persist Report picker visibility and add collapsed-state
  quick switching from the selected Report identity.

## Impact

- Depends on the completed `polish-report-page` change's collapsible Report
  picker and compact Report card presentation.
- `apps/web/components/inbox-shell.tsx`: preference-backed visibility state,
  conditional identity trigger, Popover list, and close-on-selection behavior.
- Existing `/api/ui-preferences` storage and `useUserPreferenceState` are reused;
  no new endpoint, database schema, dependency, Report format, or route is
  introduced.
- Inbox browser/component tests cover persistence, owner/browser reconciliation
  boundaries, Popover accessibility/navigation, current selection, desktop-only
  behavior, and mobile/Digest regressions.
