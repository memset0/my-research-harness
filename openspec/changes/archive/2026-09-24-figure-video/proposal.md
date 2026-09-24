## Why

Research pages need to show validation and rollout videos next to their captions the same way `figure@1` shows images. Today a video can only be linked or wrapped in hand-written `embed@1` HTML, and nothing prevents a page with a dozen videos from downloading all of them on open.

## What Changes

- `figure@1` accepts `video` instead of `image` (same path rules: document-relative or absolute inside the project root) plus an optional `poster` image path. Exactly one of `image`/`video` is required; `poster` requires `video`.
- A video renders as a thumbnail with a play button. The thumbnail is the `poster` when given, otherwise the video's first frame read by the browser through ranged metadata requests (thumbnails mount only near the viewport). The full video is requested only when the reader clicks; it then plays with native controls. Load failure shows the same caption-and-notice fallback as images.
- The document asset route serves `.mp4` (`video/mp4`) and `.webm` (`video/webm`) with the existing byte-range support.
- The `memon-components` skill documents video figures (placement, formats, poster, faststart); the generated field table picks up the new fields.
- Central + skills change -> MINOR release. Existing figure blocks are unchanged.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `document-components`: `figure@1` shows an image or a click-to-play video.
- `component-execution`: the document asset route serves video types with range requests.

## Impact

- `apps/web/lib/components/figure/v1/{index.ts,render.tsx}` (+ tests), `apps/web/app/api/doc-assets/[project]/[...path]/route.ts` (+ test), generated component registry/skill table, `packages/skills/memon-components/SKILL.md`, mock fixture `docs/wiki/showcase/W0009-figure-gallery.md` with a small neutral video.
