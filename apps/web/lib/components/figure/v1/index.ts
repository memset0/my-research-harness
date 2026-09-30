import { z } from 'zod'
import { defineComponent } from '../../types'

const path =
  'relative to the containing Markdown document, or an absolute path inside the project root'

const schema = z.object({
  image: z
    .string()
    .min(1)
    .optional()
    .describe(`Image path ${path}. Give exactly one of \`image\` or \`video\`.`),
  video: z
    .string()
    .min(1)
    .optional()
    .describe(
      `Video path (MP4 or WebM) ${path}. Shown as a thumbnail; the video downloads and plays only when the reader clicks it.`,
    ),
  poster: z
    .string()
    .min(1)
    .optional()
    .describe(
      `Thumbnail image path for \`video\`, ${path}. Without it the dashboard server extracts the first frame as the thumbnail (placeholder tile when it cannot).`,
    ),
  caption: z.string().trim().min(1).describe('Visible caption displayed below the image or video.'),
  description: z
    .string()
    .trim()
    .min(1)
    .optional()
    .describe(
      'Alternative text and readable fallback detail for the image or video; defaults to the caption.',
    ),
})

const example = [
  '```yaml figure@1 #pipeline',
  'image: W0009-figure-gallery__assets/pipeline.svg',
  'caption: Figure 1. A three-stage processing pipeline.',
  'description: Input, Process, and Output boxes connected from left to right.',
  '```',
].join('\n')

const videoExample = [
  '```yaml figure@1 #rollout',
  'video: W0009-figure-gallery__assets/rollout.mp4',
  'poster: W0009-figure-gallery__assets/rollout.jpg',
  'caption: Video 1. A four-step rollout of the validation prompt.',
  '```',
].join('\n')

export const descriptor = defineComponent({
  type: 'figure',
  version: 1,
  description:
    'A document-relative image, or a click-to-play video, with a visible caption and agent-readable description.',
  useWhen:
    'Use for a local image, plot snapshot, or video (validation samples, rollouts) that needs a durable visible caption. Keep the file beside the document (usually in its `<stem>__assets` directory) and describe what it shows. A video shows only a thumbnail until the reader clicks it, so a page may carry several. Use `embed@1` instead when interaction beyond playback matters.',
  schema,
  refine: (data, ctx) => {
    if ((data.image === undefined) === (data.video === undefined)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [data.image === undefined ? 'image' : 'video'],
        message: 'give exactly one of `image` or `video`',
      })
    }
    if (data.poster !== undefined && data.video === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['poster'],
        message: '`poster` requires `video`',
      })
    }
  },
  example,
  invalidExamples: [
    { block: example.replace(/^caption:.*\n/m, ''), code: 'WIKI_COMPONENT_INVALID' },
    {
      block: example.replace('image: W0009-figure-gallery__assets/pipeline.svg', 'image: ""'),
      code: 'WIKI_COMPONENT_INVALID',
    },
    {
      block: videoExample.replace(
        'poster:',
        'image: W0009-figure-gallery__assets/pipeline.svg\nposter:',
      ),
      code: 'WIKI_COMPONENT_INVALID',
    },
    {
      block: example.replace(
        'caption:',
        'poster: W0009-figure-gallery__assets/rollout.jpg\ncaption:',
      ),
      code: 'WIKI_COMPONENT_INVALID',
    },
  ],
  fixtures: ['docs/wiki/showcase/W0009-figure-gallery.md'],
})
