## ADDED Requirements

### Requirement: Three-mode theme preference

The dashboard SHALL allow each visitor to choose between three color-scheme preferences: `light`, `dark`, and `system`. The `system` preference SHALL track the browser's `prefers-color-scheme` media query and update live when that value changes (e.g. the OS toggles dark mode at sunset).

The chosen preference SHALL be persisted in `localStorage` under a key managed by the `next-themes` runtime, scoped to the browser. The preference SHALL NOT be transmitted to the server, written into `config.yml`, or carried in any cookie.

#### Scenario: User selects Light

- **WHEN** a user clicks the Light slot in the theme toggle
- **THEN** the `<html>` element loses its `dark` class (if present)
- **AND** the page repaints with the `:root` token set defined in `apps/web/app/globals.css`
- **AND** the choice persists across page reloads
- **AND** the choice survives a hard refresh without producing a flash of the previous theme

#### Scenario: User selects Dark

- **WHEN** a user clicks the Dark slot
- **THEN** the `<html>` element acquires `class="dark"`
- **AND** the page repaints with the `.dark` token set defined in `apps/web/app/globals.css`
- **AND** the choice persists across page reloads

#### Scenario: User selects System and OS is in dark mode

- **WHEN** a user clicks the System slot
- **AND** the browser reports `(prefers-color-scheme: dark)`
- **THEN** the `<html>` element has `class="dark"`
- **AND** the segmented control's System slot is the visually-active slot

#### Scenario: User selects System and OS switches dark↔light mid-session

- **WHEN** the user's preference is `system`
- **AND** the OS color scheme changes (e.g., scheduled dark-at-night kicks in)
- **THEN** the `<html>` element's `dark` class toggles to match within one media-query event tick
- **AND** the segmented control's System slot remains the visually-active slot

### Requirement: No flash of wrong theme on initial paint

The dashboard SHALL apply the user's persisted theme preference (or the OS-resolved value for System) **before** the first paint of the document body. The page SHALL NOT render with the default (light) palette and then switch to dark — even for a single frame.

#### Scenario: First paint matches persisted preference

- **WHEN** a user with `dark` saved in `localStorage` reloads the page
- **THEN** the first painted frame already has the `.dark` token set applied
- **AND** the document body is not visually rendered with light-theme tokens at any point during load

### Requirement: Theme toggle UI in the sidebar header

A theme-toggle control SHALL be rendered in the sidebar header on every authenticated and viewer-mode page that mounts the sidebar. The control SHALL be positioned right-aligned within the sidebar header row, with the `memon` wordmark left-aligned in the same row.

The control SHALL be a single-select segmented control with exactly three slots in the order: Light, Dark, System. The currently selected slot SHALL be visually distinct (via a positioned indicator element). When the selection changes, the indicator SHALL animate horizontally to the newly selected slot.

#### Scenario: Toggle is visible on the project dashboard

- **WHEN** a logged-in owner navigates to `/p/<project>`
- **THEN** the sidebar header contains a `memon` `Link` element on the left
- **AND** the sidebar header contains a theme-toggle group on the right
- **AND** the toggle group has three slots labeled Light, Dark, and System

#### Scenario: Toggle is visible to a share-cookie viewer

- **WHEN** a user holds a `memon-shares` cookie for project X
- **AND** the user visits `/p/X`
- **THEN** the same theme-toggle group is visible in the sidebar header
- **AND** clicking any slot changes the theme exactly as for owner sessions

#### Scenario: Indicator animates between slots

- **WHEN** the active selection changes from Light to System
- **THEN** the indicator element translates horizontally across the intermediate Dark slot
- **AND** the animation duration is short enough to feel responsive (under 250ms)
- **AND** no other elements in the sidebar header reflow during the animation

#### Scenario: Sidebar header layout is stable before the toggle mounts

- **WHEN** the page first renders server-side
- **AND** the client has not yet hydrated `next-themes`
- **THEN** the toggle's slot reserves the exact width and height the mounted toggle will occupy
- **AND** the `memon` wordmark does not shift position when the toggle hydrates

### Requirement: Accessibility of the theme toggle

The toggle SHALL expose its three options via ARIA roles understood by screen readers. The slots SHALL be keyboard-focusable; arrow keys move focus between adjacent slots; Space or Enter activates the focused slot.

Each slot SHALL carry a human-readable accessible name identifying its mode (Light, Dark, or System).

#### Scenario: Keyboard navigation

- **WHEN** a keyboard user tabs into the toggle and presses Right Arrow
- **THEN** focus moves to the next slot in the group
- **AND** pressing Space activates the focused slot

#### Scenario: Screen-reader labels

- **WHEN** a screen reader encounters each slot
- **THEN** it announces the slot's accessible name (Light / Dark / System)
- **AND** it announces which slot is currently selected

### Requirement: Server-side state is unaffected

Theme is a pure client-side preference. The runtime SHALL NOT:
- write any field to `config.yml`,
- include theme in any session cookie payload,
- mutate any server-side store on theme change.

#### Scenario: Theme change is server-silent

- **WHEN** the user toggles between any of the three modes
- **THEN** no HTTP request is issued to the server as a result of the toggle
- **AND** the `memon-session` cookie payload is unchanged
- **AND** `config.yml` is not modified
