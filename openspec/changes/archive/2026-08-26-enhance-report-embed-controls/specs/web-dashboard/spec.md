## MODIFIED Requirements

### Requirement: Embedded Report HTML uses a responsive, recoverable iframe wrapper

When the shared Markdown renderer encounters the existing local `.html`/`.htm` image syntax for a directory Report, it SHALL render a reusable Report HTML embed wrapper rather than a bare iframe. The iframe SHALL keep the resolved same-origin Report asset URL, an accessible title derived from the Markdown alt/title, lazy loading, and no `sandbox` attribute.

The wrapper SHALL provide:

- a visible loading state until the iframe reports a successful load;
- a visible error state when the iframe emits a load error or does not load within a bounded timeout after approaching the viewport;
- a Retry action that starts a fresh iframe load;
- an Open in new tab action using the same Report asset URL with opener isolation;
- an Expand action that covers the current application page without invoking the browser Fullscreen API.

Normal embed height SHALL use a small-viewport-height fallback and a dynamic-viewport-height override (`svh` then `dvh`, or equivalent) with bounded responsive sizing. It SHALL fit within the usable viewport at 390 CSS pixels wide and SHALL NOT impose a fixed desktop minimum taller than that viewport. In expanded mode, the wrapper and iframe SHALL fill the available dynamic viewport above the current browser page.

The host SHALL NOT inspect iframe document height, accept postMessage resize events, require declared dimensions/manifest data, or otherwise auto-size to iframe content. The existing same-origin unsandboxed trust model and server-side Report-directory path confinement remain unchanged.

#### Scenario: Loading succeeds

- **GIVEN** a bundle README containing `![Training curves](./views/loss-curves/index.html)`
- **WHEN** the Report detail renders and a near-viewport iframe has not fired `load`
- **THEN** the wrapper shows a loading state and its view actions remain identifiable
- **WHEN** the iframe fires `load`
- **THEN** the loading state clears and the iframe remains titled `Training curves` without a `sandbox` attribute

#### Scenario: Failed load can be retried or opened separately

- **GIVEN** a near-viewport embedded Report view emits an error or exceeds the bounded load timeout
- **WHEN** the wrapper enters its error state
- **THEN** it shows an understandable error with Retry and Open in new tab
- **WHEN** the user chooses Retry
- **THEN** the wrapper starts a fresh iframe load rather than leaving the failed instance as the terminal state

#### Scenario: Fullscreen fills the dynamic viewport

- **GIVEN** a Report view is loaded
- **WHEN** the user activates the replacement in-page Expand action
- **THEN** the embed wrapper covers the application page and the iframe fills its available `dvh`-based viewport
- **AND** the visible Exit action or Escape returns it to the responsive inline height without browser fullscreen

#### Scenario: Fullscreen unavailable falls back gracefully

- **GIVEN** the browser does not support or permit the Fullscreen API
- **WHEN** the user activates Expand
- **THEN** page-internal expanded mode still works because it does not call that API
- **AND** Open in new tab remains available and points to the same Report asset URL

#### Scenario: Mobile and desktop host sizing remain usable

- **WHEN** the same Report embed is rendered once at exactly 390 CSS pixels wide and once at a desktop width of at least 1280 CSS pixels
- **THEN** loading/error text and all responsive menu or direct actions remain reachable without overlap or page-level horizontal clipping at both widths
- **AND** the mobile embed height fits the usable viewport without inheriting a desktop-sized fixed minimum

#### Scenario: Existing Report forms keep their behavior

- **GIVEN** an old directory bundle embeds `![Chart](./chart.html)`, another README uses `[Open chart](./chart.html)`, and a standalone Markdown Report has no resource base URL
- **WHEN** all three render after this change
- **THEN** the old image-form HTML gets the responsive wrapper, the normal link remains a link, and the standalone Markdown Report renders without an iframe
- **AND** none requires a manifest or file rewrite

## ADDED Requirements

### Requirement: Report HTML embeds expose controlled reload and change awareness

Every Report HTML embed SHALL expose a Reload action that revalidates the canonical Report asset URL and mounts a fresh iframe browsing context only after validation succeeds. Reload SHALL preserve the iframe title, zoom percentage, host layout, and Open-in-new-tab destination.

While a ready embed is visible in an active browser document, the client SHALL perform a header-only resource revision check no more frequently than once per minute. When the served HTML entry revision differs from the revision last loaded, Reload SHALL display a small semantic update indicator with an accessible description. The client SHALL NOT automatically reload the iframe or discard its state. A successful manual Reload SHALL clear the indicator and establish the new baseline.

#### Scenario: Changed entry invites an explicit reload
- **GIVEN** an embedded Report entry loaded with revision A
- **WHEN** a later low-frequency HEAD check returns revision B
- **THEN** Reload displays an accessible update indicator
- **AND** the existing iframe remains mounted at revision A until the user acts
- **WHEN** the user activates Reload and its probe succeeds
- **THEN** a fresh iframe loads from the same canonical URL
- **AND** the update indicator clears

#### Scenario: Hidden documents do not poll
- **GIVEN** a ready Report embed and a hidden browser document
- **WHEN** its normal revision interval elapses
- **THEN** no revision request is sent until the document is visible again

### Requirement: Report HTML expanded mode remains inside the page

The embed Expand action SHALL open a temporary page-internal focused view rather than invoke the browser Fullscreen API. The focused wrapper SHALL cover the application content viewport above project headers, sidebars, drawers, and split panes; lock background body scrolling; keep the iframe toolbar available; and fill the remaining dynamic viewport height. It SHALL work identically from a full Report, right split, or Report drawer.

The user SHALL be able to exit through a visible action or Escape. Exit and component cleanup SHALL restore prior body and ancestor inline styles without navigating or reloading the surrounding Report.

#### Scenario: Side Report expands over the complete application
- **GIVEN** an iframe inside a Report drawer or right split
- **WHEN** the user activates Expand
- **THEN** the iframe wrapper covers the complete page viewport rather than only its side pane
- **AND** the project header/sidebar are temporarily obscured without entering browser fullscreen
- **WHEN** the user presses Escape
- **THEN** the iframe returns to its original side Report position and background scrolling is restored

### Requirement: Mobile Report iframe actions use a compact overflow menu

Below the `sm` breakpoint, an iframe toolbar SHALL show its truncated title and one accessible three-dot action trigger in a single compact row. Zoom out, current zoom, zoom in, Reload/update state, Open in new tab, and Expand/Exit SHALL be available inside that menu. The zoom actions SHALL retain the direct horizontal minus/current-percentage/plus stepper presentation used by the desktop toolbar, and repeated zoom adjustments SHALL keep the action menu open. The direct desktop action group SHALL be hidden on mobile and SHALL remain visible at `sm` and wider.

#### Scenario: Mobile header stays compact with every action reachable
- **GIVEN** a Report iframe at a mobile viewport width
- **WHEN** its toolbar renders
- **THEN** only the title and action-menu trigger occupy the toolbar row
- **WHEN** the user opens the action menu
- **THEN** zoom, Reload, Open in new tab, and Expand actions are keyboard and pointer accessible
- **AND** activating minus or plus repeatedly updates the visible percentage without closing the menu

### Requirement: Lazy iframe timeout begins near the viewport

A successfully probed Report iframe SHALL remain lazy-loaded. In browsers with IntersectionObserver, its bounded post-probe load timeout SHALL begin only when the wrapper enters a configured proximity margin around the viewport. A below-fold iframe SHALL remain mounted while deferred and SHALL not enter an error state merely because the timeout duration elapsed before it approached the viewport. Browsers without IntersectionObserver MAY start the timer immediately for compatibility.

#### Scenario: Later plots are not failed while below the fold
- **GIVEN** one Report contains multiple lazy iframe plots and a later plot is outside the viewport proximity margin
- **WHEN** more than the normal load-timeout duration elapses before the user scrolls to it
- **THEN** the later iframe remains mounted in its loading state
- **WHEN** it approaches the viewport
- **THEN** its bounded load timer begins and normal load/error handling resumes
