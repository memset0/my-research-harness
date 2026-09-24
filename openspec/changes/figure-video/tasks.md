## 1. Implementation

- [x] 1.1 Descriptor: `video`/`poster` fields, exactly-one refine, invalid examples, regenerated registry and skill table; schema tests.
- [x] 1.2 Renderer: poster or lazy metadata thumbnail, click-to-play video, error fallback; render tests.
- [x] 1.3 Asset route: mp4/webm content types; range test for a video.
- [x] 1.4 Skill guidance for video figures and a neutral fixture video in `W0009-figure-gallery`.

## 2. Verification

- [x] 2.1 Focused tests, typecheck, full local suite; browser check that no video bytes load before the click and that playback starts after it.
