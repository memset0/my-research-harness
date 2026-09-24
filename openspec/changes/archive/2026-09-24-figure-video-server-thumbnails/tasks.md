## 1. Implementation

- [x] 1.1 Config: `media.ffmpeg` in schema, types, loader resolution, `config.example.yml`; loader test.
- [x] 1.2 Route: `?thumbnail=1` extraction with validators, concurrency/time/size bounds, 404 on failure; route tests with a stub ffmpeg.
- [x] 1.3 Renderer: server thumbnail or poster image, placeholder on error, click to play; render tests; skill wording.

## 2. Verification

- [x] 2.1 Focused tests, typecheck, full local suite; browser check on the release build that zero video bytes load before the click and playback starts after it.
