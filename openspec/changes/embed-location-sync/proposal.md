## Why

Static and live HTML Reports and Wiki pages navigate inside their iframe (`?tab=…`, `#/eval/…`, another page of the bundle), but the memon page URL stays on the entry, so a reload or a shared link loses the place.

## What Changes

- On full Report and Wiki pages, the embed reports its frame location after every load, fragment change and History API update; the page URL mirrors it with `history.replaceState`: the frame fragment becomes the page fragment, and a path or query different from the entry document goes into the `view` parameter (relative to the entry's directory). Other parameters (`expanded`, `share`) are kept.
- Opening such a URL starts the frame at that `view` and fragment; a changed page fragment is applied to the frame. Locations outside the entry's directory or origin are neither mirrored nor restored. Reload resumes from the frame's current location.

## Capabilities

### New Capabilities
- `embed-location-sync`: page URL mirrors the embedded document location.

### Modified Capabilities

## Impact

`apps/web/lib/embed-location.ts`, `components/{expanded-view,content-presentation,report-html-embed}.tsx` and tests. Central-only: PATCH release.
