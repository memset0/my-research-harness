## Why

v6.17 shows posterless video figures with a `preload="metadata"` `<video>` thumbnail. Measured on the release build, Chrome read 280 KB to 2.7 MB of a 3.9 MB MP4 before any click: open-ended range reads stream until the browser cancels, and the amount varies run to run. That breaks the requirement that a video downloads only when the reader clicks it.

## What Changes

- The dashboard server extracts the thumbnail: `GET /api/doc-assets/<project>/<video>?thumbnail=1` returns a JPEG of the first frame (max 960 px wide) produced by ffmpeg, with ETag/Last-Modified derived from the video's stat so revalidations are 304 without running ffmpeg. Extraction runs at most two at a time, is killed after 15 s, and caps output at 5 MB.
- The ffmpeg executable is configured by the new optional instance config key `media.ffmpeg` (a path, relative to the config file, or a command on `PATH`; default `ffmpeg`).
- `figure@1` posterless videos render that JPEG as a lazy `<img>`; if it is unavailable they show a neutral placeholder tile with the play button. No video byte is requested before the click in any case. The metadata `<video>` thumbnail and its viewport observer are removed.
- `memon-components` skill wording updated; `config.example.yml` documents `media.ffmpeg`.
- Central + CLI (core config schema) + skills -> MINOR release.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `document-components`: posterless video thumbnails come from the server; no video bytes before activation.
- `component-execution`: the document asset route extracts thumbnails with the configured ffmpeg.

## Impact

- `packages/core/src/{schemas.ts,types.ts,config/load.ts}` (+ load test), `apps/web/app/api/doc-assets/[project]/[...path]/route.ts` (+ test), `apps/web/lib/components/figure/v1/{render.tsx,render.test.tsx,index.ts}`, generated skill table, `packages/skills/memon-components/SKILL.md`, `config.example.yml`.
- Deployment: the central machine needs an ffmpeg binary; without it posterless videos show the placeholder.
