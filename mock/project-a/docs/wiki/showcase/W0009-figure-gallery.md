---
id: W0009
kind: showcase
title: Figure component gallery
description: A page-local SVG and a click-to-play video, each with a caption and an agent-readable description.
tags: [components, figure]
created_at: 2026-09-08T12:00:00+00:00
updated_at: 2026-09-08T12:00:00+00:00
---

# Figure component gallery

## Processing pipeline

The image lives beside the page, in the document's own `__assets` directory.

```yaml figure@1 #pipeline
image: W0009-figure-gallery__assets/pipeline-overview.svg
caption: Figure 1. A three-stage processing pipeline.
description: Three white boxes labeled Input, Process, and Output on a pale background, connected by teal left-to-right arrows.
```

## Rollout video

A video figure shows a thumbnail and downloads the file only when the reader clicks it.

```yaml figure@1 #rollout
video: W0009-figure-gallery__assets/rollout.webm
poster: W0009-figure-gallery__assets/rollout-poster.png
caption: Video 1. A marker stepping through four positions.
description: A teal dot on a pale background jumps right in four equal steps above a grey baseline, under the label "Rollout, 4 steps".
```

Without a poster the thumbnail is the video's first frame.

```yaml figure@1 #rollout_frame
video: W0009-figure-gallery__assets/rollout.webm
caption: Video 2. The same clip with its first frame as the thumbnail.
```
