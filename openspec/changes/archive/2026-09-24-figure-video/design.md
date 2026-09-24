## Context

`figure@1` is `{ image, caption, description? }`, rendered as a lazy `<img>` through `block.resourceUrl`. The document asset route serves an extension allow-list with ETag/Last-Modified validators and single byte ranges (206/416). No server-side ffmpeg exists on the central machine, so server-generated thumbnails are not an option without a new system dependency.

## Decisions

1. **Schema**: `image` becomes optional, `video` and `poster` are new optional path fields; the descriptor `refine` requires exactly one of `image`/`video` and rejects `poster` without `video` (issue paths name the field). No major bump: every existing block stays valid.
2. **Thumbnail without server work**: with `poster`, an `<img>` (lazy) is the thumbnail and no video byte is requested before the click. Without `poster`, a muted, controls-less `<video preload="metadata" src="<url>">` renders the first frame; the browser reads the header, index and first frame (about 7% of a 3.9 MB MP4 whose index sits at the end) and stops. A `#t=` seek fragment is deliberately absent: it made Chrome buffer about 70% of the same file. It mounts only when an IntersectionObserver (200px margin) reports it near the viewport, so a long page does not probe every video at load; environments without IntersectionObserver mount immediately.
3. **Click to play**: the thumbnail is a `<button>` (accessible name `Play video: <caption>`) with a play icon overlay. Activation replaces it with `<video controls autoPlay playsInline preload="auto" src="<url>" poster=…>`; the full download starts then. `onError` on either element shows the existing notice fallback (`Video unavailable: <path>`).
4. **Route**: add `.mp4 → video/mp4` and `.webm → video/webm`; caching and range handling are unchanged (`private, no-cache` with validators).
5. **Formats in the skill**: MP4 (H.264/AAC, `-movflags +faststart` so metadata sits at the front) or WebM; keep files beside the document in `<stem>__assets/`; a poster is recommended for large videos and for iOS Safari, which ignores metadata preloading.
