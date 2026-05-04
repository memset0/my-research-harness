## ADDED Requirements

### Requirement: Top navigation progress bar

The dashboard SHALL render a global, fixed-position progress bar across the very top of the viewport that becomes visible whenever an App-Router soft navigation is in flight, providing immediate feedback that the user's click was registered. The bar SHALL be mounted once at the root layout (alongside the existing `<Toaster />`), be `pointer-events: none`, and be visually layered above all page content (z-index higher than the AppBar, lower than toasts).

The filled portion of the bar SHALL use the project's `--primary` theme color (bound via a CSS override on the bar's selector, not via a hard-coded color in JS); the unfilled portion SHALL be fully transparent (no track, no background fill, no shadow / peg). The bar SHALL be approximately 2 px tall.

The bar SHALL run an **indeterminate** animation curve (no real progress measurement): it SHALL grow rapidly on start, decelerate toward ~90 %, snap to 100 % when the new route commits, then fade out and reset.

The bar SHALL trigger on every App-Router soft-navigation path: `<Link>` clicks, programmatic `router.push` / `router.replace`, and browser back/forward. The bar SHALL NOT trigger on hash-only navigation, on clicks that open in a new tab/window (modifier-key clicks, `target="_blank"`, non-primary mouse button), or on external-origin clicks.

#### Scenario: Soft navigation via Link click
- **WHEN** the user clicks a `<Link>` whose destination differs from the current pathname or search string, with no modifier keys and primary mouse button
- **THEN** within ≤50 ms the top progress bar appears and begins crawling toward the right edge using the `--primary` token

#### Scenario: Soft navigation via programmatic router
- **WHEN** code calls `router.push(href)` or `router.replace(href)` with a different destination
- **THEN** the bar appears and crawls in the same way as a `<Link>` click

#### Scenario: Browser back / forward
- **WHEN** the user presses the browser back or forward button to a different route
- **THEN** the bar appears and crawls until the destination route commits

#### Scenario: Navigation settles
- **WHEN** the App Router commits the new segment
- **THEN** the bar snaps to 100 %, fades out, and resets to its idle (invisible) state

#### Scenario: Modifier-key / non-primary-button click does not start the bar
- **WHEN** the user clicks a link while holding `Cmd`, `Ctrl`, `Shift`, or `Alt`, OR clicks with a non-primary mouse button, OR the link has `target="_blank"`
- **THEN** the bar does NOT appear (the click opens in a new tab/window; there is no in-page navigation to report)

#### Scenario: External link does not start the bar
- **WHEN** the user clicks an `<a>` whose `href` resolves to a different origin than `window.location.origin`
- **THEN** the bar does NOT appear (the page is leaving anyway; the browser's native loading indicator covers it)

#### Scenario: Hash-only / same-URL click does not start the bar
- **WHEN** the user clicks a link whose only difference from the current URL is the hash fragment, OR whose pathname and search exactly match the current URL
- **THEN** the bar does NOT appear (no fetch will occur)

#### Scenario: Theme color follows the `--primary` token
- **WHEN** the dashboard's `--primary` CSS variable is changed (e.g., light → dark mode)
- **THEN** the bar's filled color tracks the new value on its next render — no hard-coded hex / oklch in the JS or in any inline style overriding the token
