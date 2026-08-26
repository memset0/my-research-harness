## Context

`ReportHtmlEmbed` currently performs a full GET probe, mounts a lazy same-origin iframe, and starts a 15-second iframe timer as soon as the probe succeeds. The timer does not know whether the browser deferred navigation because the iframe is far below the viewport. The toolbar directly exposes zoom, new-tab, and browser Fullscreen API actions at every width.

## Goals / Non-Goals

**Goals:**

- Let readers deliberately reload changed HTML without reloading the Report.
- Detect entry-resource changes with low bandwidth and no automatic disruption.
- Provide a focus mode that remains inside the browser page and escapes drawer/split constraints.
- Keep the mobile header to one compact title/action row.
- Preserve lazy loading for Reports containing many embeds.

**Non-Goals:**

- Watch every transitive JavaScript, CSS, image, or data dependency referenced by an HTML entry.
- Automatically reload an iframe and discard its client state.
- Add a WebSocket/SSE protocol or Report bundle manifest.
- Inspect iframe DOM/content height or change the trusted unsandboxed model.

## Decisions

### 1. Poll resource metadata, not the HTML body

The asset route exposes `ETag`, `Last-Modified`, and `X-Memon-Resource-Version` from the resolved file's size and mtime, and supports `HEAD` through the same authorization and path-confinement logic as GET. Each ready embed polls no more often than once per minute while the document is visible. A changed revision marks Reload with a dot; it never reloads automatically.

### 2. Reload through the existing probe lifecycle

Reload clears the update marker, increments the attempt identity, re-runs the validated GET probe, and mounts a new iframe browsing context only after that probe succeeds. The canonical `src` and Open-in-new-tab destination remain stable.

### 3. Use an in-page fixed focus layer

Expanded mode uses a fixed, high-z-index wrapper and temporarily locks body scrolling. When nested under a Radix Sheet, an inline `transform: none` override on the Sheet content removes the transformed containing block so the fixed wrapper covers the complete viewport. Escape and the visible Exit action restore all previous inline styles. No browser Fullscreen API is called.

### 4. Mobile uses a single action menu

Below `sm`, the toolbar shows the truncated title and one three-dot trigger. The menu contains zoom, reload/update state, open in new tab, and expand/exit. Zoom retains the familiar horizontal minus/percentage/plus stepper; its Radix select handlers prevent menu dismissal so readers can make consecutive 10-point adjustments. At `sm` and wider the existing direct controls remain visible with Reload and expanded-mode actions added.

### 5. Observe before timing a lazy iframe

The iframe remains mounted with `loading="lazy"` after a successful probe. An IntersectionObserver with a prefetch margin marks the embed near the viewport; only then does the bounded iframe-load timeout begin. Browsers without IntersectionObserver retain the existing immediate bounded timeout.

## Risks / Trade-offs

- Entry-resource polling does not notice a data-only edit when the entry HTML metadata is unchanged; explicit Reload remains available for that case.
- A one-minute interval favors bandwidth over instant notification.
- Radix drawer focus mode needs temporary ancestor style restoration; cleanup handles exit and unmount.
