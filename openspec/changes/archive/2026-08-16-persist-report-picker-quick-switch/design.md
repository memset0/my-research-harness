## Context

The completed `polish-report-page` change owns Report picker visibility in a
component-local boolean that defaults to open. Its selected-item toolbar renders
the Report ID and slug as separate passive spans; when the rail is hidden the
only navigation path is to show it again. `RailList` already renders the compact
native-link Report cards needed by a second list surface.

The web app now has `useUserPreferenceState`, a browser-first hook that mirrors
authenticated-owner preferences through `/api/ui-preferences` and keeps viewer
or anonymous sessions local. A shared shadcn Popover primitive is also already
available.

## Goals / Non-Goals

**Goals:**

- Restore one Report picker preference consistently across Report routes and
  projects.
- Keep the current Report identity compact while making it an obvious,
  accessible quick-switch affordance only when the rail is hidden on desktop.
- Reuse existing Report card links and preference/Popover infrastructure.

**Non-Goals:**

- Persisting whether the quick-switch Popover itself is open.
- Adding search, filtering, reordering, keyboard shortcuts, or recent-Report
  ranking to the quick switcher.
- Replacing the mobile Sheet or changing Digest navigation.
- Adding a new API, cookie, database table, or Report route.

## Decisions

### D1. Store one global Report picker boolean through `useUserPreferenceState`

`InboxShell` will replace its local `useState(true)` value with
`useUserPreferenceState<boolean>('memon:reports:picker-open', true)`. One global
preference matches the user's intent to choose a focused or navigation-heavy
Report layout; a per-project key would make the same chrome unexpectedly reopen
when changing projects.

The existing hook updates React state and localStorage synchronously, then
reconciles owner state through serialized server writes. It also already
implements the required server-authoritative and viewer-local boundaries, so a
new storage path would duplicate mature behavior.

The resolved value will still be checked with `typeof value === 'boolean'` at
the component boundary. The hook's generic type cannot validate JSON recovered
from old/corrupt browser or server rows, so any non-boolean value falls back to
the default-open layout.

### D2. Make only the collapsed desktop identity a Popover trigger

The selected toolbar will render a small Report identity component. In expanded
state it emits the current ID/slug as ordinary metadata. In collapsed state it
keeps ordinary metadata for mobile and renders a desktop-only ghost/unstyled
shadcn Button as a Popover trigger containing the ID, slug, and a small chevron.
The accessible name will state that it switches Reports rather than relying on
the chevron alone.

Keeping the trigger conditional avoids two adjacent full-list controls while
the rail is open. A permanently visible dropdown was considered but would
compete with the rail and obscure why the identity changed behavior. Mobile
continues to use the larger FAB/Sheet target instead of placing a small Popover
in a narrow toolbar.

### D3. Reuse `RailList` inside a bounded Popover

The Popover content will provide a compact `Reports` header and a
`max-height`/`overflow-y-auto` body containing the existing Report-mode
`RailList`. The list already supplies native routes, ID/title/slug hierarchy,
semantic card states, and `aria-current`. Its optional `onSelect` callback will
close the controlled Popover before link navigation proceeds.

`useItemsList` will expose the relevant query's actual loading state alongside
its items, replacing the current ineffective `loading={!items}` check. The
desktop rail, mobile Sheet, and Popover will therefore share skeleton/empty
behavior as well as card presentation.

Reusing `RailList` prevents the desktop rail, mobile Sheet, and quick switcher
from drifting. The Popover adds only surface-level framing and scrolling; it
does not own query state or introduce a second Report fetch.

### D4. Let Radix own focus and dismissal semantics

The Popover will be controlled only so item selection can close it explicitly;
Radix retains trigger keyboard activation, outside/Escape dismissal, collision
positioning, and focus return. `PopoverContent` receives an accessible label,
aligns to the start of the identity, and uses semantic shadcn tokens. No custom
document listeners or focus restoration code is needed.

## Risks / Trade-offs

- [Risk] Preference reconciliation can change the rail after the component's
  first client render. → Use the established browser-first hook and keep both
  layouts valid during reconciliation; do not block the page on preference I/O.
- [Risk] Reusing `RailList` could accidentally close or restyle the permanent
  rail. → Keep quick-switch framing outside `RailList` and regression-test all
  three Report list surfaces plus the Digest row path.
- [Risk] A long title/slug can crowd the toolbar. → Give the trigger a
  constrained `min-w-0` layout with truncation while retaining the full identity
  in its accessible name/title.
- [Trade-off] The preference is global rather than per project. This provides a
  consistent reading-mode choice and avoids multiplying preference rows.

## Migration Plan

No data migration is required. Users without the new preference see the current
default-open behavior. Rollback removes the preference read and Popover; the
unused boolean in browser/owner preference storage is harmless.
