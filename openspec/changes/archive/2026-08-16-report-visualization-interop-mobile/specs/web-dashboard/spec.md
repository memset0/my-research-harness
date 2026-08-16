## ADDED Requirements

### Requirement: Embedded Report HTML uses a responsive, recoverable iframe wrapper

When the shared Markdown renderer encounters the existing local `.html`/`.htm`
image syntax for a directory Report, it SHALL render a reusable Report HTML
embed wrapper rather than a bare iframe. The iframe SHALL keep the resolved
same-origin Report asset URL, an accessible title derived from the Markdown
alt/title, lazy loading, and no `sandbox` attribute.

The wrapper SHALL provide:

- a visible loading state until the iframe reports a successful load;
- a visible error state when the iframe emits a load error or does not load
  within a bounded timeout;
- a Retry action that starts a fresh iframe load;
- an Open in new tab action using the same Report asset URL with opener
  isolation;
- a Fullscreen action using the browser Fullscreen API. When fullscreen is
  unavailable or fails, the wrapper SHALL present graceful, accessible feedback
  and SHALL keep Open in new tab available as the fallback.

Normal embed height SHALL use a small-viewport-height fallback and a
dynamic-viewport-height override (`svh` then `dvh`, or equivalent) with bounded
responsive sizing. It SHALL fit within the usable viewport at 390 CSS pixels
wide and SHALL NOT impose a fixed desktop minimum taller than that viewport. In
fullscreen, the wrapper and iframe SHALL fill the available dynamic viewport.

The host SHALL NOT inspect iframe document height, accept postMessage resize
events, require declared dimensions/manifest data, or otherwise auto-size to
iframe content. The existing same-origin unsandboxed trust model and server-side
Report-directory path confinement remain unchanged.

#### Scenario: Loading succeeds

- **GIVEN** a bundle README containing
  `![Training curves](./views/loss-curves/index.html)`
- **WHEN** the Report detail renders and the iframe has not fired `load`
- **THEN** the wrapper shows a loading state and its view actions remain
  identifiable
- **WHEN** the iframe fires `load`
- **THEN** the loading state clears and the iframe remains titled `Training
  curves` without a `sandbox` attribute

#### Scenario: Failed load can be retried or opened separately

- **GIVEN** an embedded Report view emits an error or exceeds the bounded load
  timeout
- **WHEN** the wrapper enters its error state
- **THEN** it shows an understandable error with Retry and Open in new tab
- **WHEN** the user chooses Retry
- **THEN** the wrapper starts a fresh iframe load rather than leaving the failed
  instance as the terminal state

#### Scenario: Fullscreen fills the dynamic viewport

- **GIVEN** the browser supports the Fullscreen API and the Report view is
  loaded
- **WHEN** the user activates Fullscreen
- **THEN** the embed wrapper becomes the fullscreen element and the iframe fills
  its available `dvh`-based viewport
- **AND** browser-native Escape/exit behavior returns it to the responsive inline
  height

#### Scenario: Fullscreen unavailable falls back gracefully

- **GIVEN** the browser does not support the Fullscreen API or rejects the
  request
- **WHEN** the user activates Fullscreen
- **THEN** the wrapper shows accessible feedback that fullscreen is unavailable
  or failed
- **AND** Open in new tab remains available and points to the same Report asset
  URL

#### Scenario: Mobile and desktop host sizing remain usable

- **WHEN** the same Report embed is rendered once at exactly 390 CSS pixels wide
  and once at a desktop width of at least 1280 CSS pixels
- **THEN** loading/error text and Retry/Open/Fullscreen controls remain visible
  without overlap or page-level horizontal clipping at both widths
- **AND** the mobile embed height fits the usable viewport without inheriting a
  desktop-sized fixed minimum

#### Scenario: Existing Report forms keep their behavior

- **GIVEN** an old directory bundle embeds `![Chart](./chart.html)`, another
  README uses `[Open chart](./chart.html)`, and a standalone Markdown Report has
  no resource base URL
- **WHEN** all three render after this change
- **THEN** the old image-form HTML gets the responsive wrapper, the normal link
  remains a link, and the standalone Markdown Report renders without an iframe
- **AND** none requires a manifest or file rewrite
