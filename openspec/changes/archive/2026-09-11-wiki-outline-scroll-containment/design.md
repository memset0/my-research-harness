## Context

The wiki shell is a fixed-height flex layout (`h-[calc(100svh-3rem)]`) nested in the project layout's `overflow-y-auto pb-8` content scroller inside an `overflow-hidden` `SidebarInset`. Both ancestors are programmatically scrollable even though the user cannot wheel them, so native `#fragment` navigation (outline `<a href="#id">`, in-body TOC links, initial URL hash) leaves them offset. Headings already carry `scroll-mt-16`.

## Goals / Non-Goals

- Goals: scroll only the owning reading surface; keep the URL fragment; handle deep links; cover both the sticky outline column and Markdown-rendered fragment links so the side pane and mobile inline TOC behave the same.
- Non-Goals: restructuring the project layout scroll hierarchy or changing `overflow` on shared layout primitives (risk to every other route); smooth-scroll behaviour changes.

## Decisions

1. Add `apps/web/lib/scroll-to-fragment.ts`: `scrollFragmentIntoSurface(id)` resolves the target element, walks up to the nearest ancestor with computed `overflow-y` `auto`/`scroll` (the reading surface), and sets that container's `scrollTop` from the target/container bounding rects minus the target's computed `scroll-margin-top`. Returns whether it handled the id. Alternative — `element.scrollIntoView()` — is exactly what scrolls the ancestors, so it is rejected.
2. Outline entries in `wiki-shell.tsx` and same-document `#` links rendered by the shared Markdown `a` component call `event.preventDefault()`, run the helper, then `history.replaceState` the fragment. Modifier-key clicks and links whose target is missing fall back to native behaviour.
3. `WikiSelectedPane` applies the helper once after the page body mounts when `location.hash` names a heading in the page, replacing the native load-time scroll (the browser's own hash scroll happens before hydration and already drifted the ancestors, so the effect also resets any drifted ancestor scroll offsets of the reading surface back to zero).

## Risks / Trade-offs

- Markdown `a` interception applies to every surface (reports, experiments) → only fragment links whose target exists in the document are intercepted; behaviour there becomes contained scrolling as well, which is the desired semantics for those fixed-height panes too.
- Headless verification: desktop outline click plus scroll-back and a fragment deep link checked in the browser against a real page.
