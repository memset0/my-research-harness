## Context

Measurements on the v6.17.1 release build against a 3.9 MB MP4 whose index sits at the end: posterless `preload="metadata"` thumbnail read 2.7 MB before the click; isolated elements read 0.28–1.07 MB across runs; capturing the first frame and aborting still read 2.4–3.9 MB on loopback. Only the server can bound what reaches the browser. The asset route already reads the file locally (`project.root` on the serving machine).

## Decisions

1. **Endpoint**: same route, `?thumbnail=1`, only for `.mp4`/`.webm`; any other extension with `thumbnail` → 404. Path safety is unchanged and runs first.
2. **Validators**: ETag `W/"sha1(<realpath>:<size>:<mtime>:thumb-v1)"`, Last-Modified = video mtime, `cache-control: private, no-cache`, `content-type: image/jpeg`. `isNotModified` is checked before spawning ffmpeg.
3. **Extraction**: `spawn(ffmpeg, ['-nostdin','-hide_banner','-loglevel','error','-i',<abs>,'-frames:v','1','-vf',"scale='min(960,iw)':-2",'-f','image2pipe','-c:v','mjpeg','-q:v','4','pipe:1'])`, no shell. At most 2 concurrent (module-level FIFO semaphore), SIGKILL after 15 s, abort when stdout exceeds 5 MB, non-zero exit or empty output → 404 `THUMBNAIL_UNAVAILABLE`. `ENOENT` (no ffmpeg) → same 404. No server-side cache: browser validators make repeat views free, and extraction reads only the file's head on local disk.
4. **Config**: `media: { ffmpeg: string }` (strict, optional). A value containing `/` resolves beside the config file; otherwise it is looked up on `PATH`. The loader sets `Config.media` only when configured; the route falls back to `ffmpeg`.
5. **Renderer**: thumbnail `<img loading="lazy">` with `src = poster ?? source + (source has '?' ? '&' : '?') + 'thumbnail=1'`; `onError` switches to a placeholder tile (muted background + play icon) that stays clickable. Click swaps in the `<video controls autoPlay playsInline preload="auto">`. The IntersectionObserver hook and metadata `<video>` are deleted.
