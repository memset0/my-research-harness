## MODIFIED Requirements

### Requirement: Document assets are served through a path-safe route

The dashboard SHALL serve `<stem>__assets/<file>` cache files and figure images and videos through a document asset route addressed by project and document path; every request SHALL resolve the real path and refuse anything outside the configured project roots or containing traversal, encoded separators, or NUL. Cache JSON SHALL be served with `Cache-Control: no-store`; images and videos with a content type derived from the extension (svg, png, jpg, jpeg, webp, gif, avif; mp4, webm) and a restrictive CSP for SVG. Byte-range requests SHALL be answered with `206 Partial Content` so a browser can read video metadata and seek without downloading the whole file. A video requested with `?thumbnail=1` SHALL be answered with a JPEG of its first frame (at most 960 pixels wide) extracted by the ffmpeg executable named in the instance config (`media.ffmpeg`, default `ffmpeg` on `PATH`), with validators derived from the video's size and modification time so a revalidation answers 304 without running ffmpeg; extraction SHALL be bounded in concurrency, time and output size, and when ffmpeg is missing or fails the route SHALL answer 404 `THUMBNAIL_UNAVAILABLE` without serving any video bytes.

#### Scenario: Traversal refused
- **WHEN** `/api/doc-assets/<project>/docs/wiki/note/W0004-x/../../../../config.yml` is requested
- **THEN** the route answers 400 without reading the file

#### Scenario: Video range request
- **WHEN** a figure video `rollout.mp4` is requested with `Range: bytes=0-1023`
- **THEN** the route answers 206 with `content-type: video/mp4` and exactly those 1024 bytes

#### Scenario: Thumbnail revalidation skips extraction
- **GIVEN** a browser that received the thumbnail of `rollout.mp4` with its ETag
- **WHEN** it revalidates with `If-None-Match` and the video is unchanged
- **THEN** the route answers 304 without starting ffmpeg

#### Scenario: No ffmpeg available
- **WHEN** a thumbnail is requested and the configured ffmpeg cannot be started
- **THEN** the route answers 404 `THUMBNAIL_UNAVAILABLE` and the figure shows its placeholder tile
