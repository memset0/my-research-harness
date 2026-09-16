import { z } from 'zod'
import { defineComponent } from '../../types'

const schema = z.object({
  image: z.string().min(1).describe('Image path relative to the containing Markdown document, or an absolute path inside the project root.'),
  caption: z.string().trim().min(1).describe('Visible caption displayed below the image.'),
  description: z.string().trim().min(1).optional().describe('Image alternative text and readable fallback detail; defaults to the caption.'),
})

const example = [
  '```yaml figure@1 #pipeline',
  'image: W0009-figure-gallery__assets/pipeline.svg',
  'caption: Figure 1. A three-stage processing pipeline.',
  'description: Input, Process, and Output boxes connected from left to right.',
  '```',
].join('\n')

export const descriptor = defineComponent({
  type: 'figure',
  version: 1,
  description: 'A document-relative image with a visible caption and agent-readable description.',
  useWhen: 'Use for a local image or plot snapshot that needs a durable visible caption. Keep the image beside the document (usually in its `<stem>__assets` directory), describe what the pixels show, and use `embed@1` instead when interaction matters.',
  schema,
  example,
  invalidExamples: [
    { block: example.replace(/^caption:.*\n/m, ''), code: 'WIKI_COMPONENT_INVALID' },
    { block: example.replace('image: W0009-figure-gallery__assets/pipeline.svg', 'image: ""'), code: 'WIKI_COMPONENT_INVALID' },
  ],
  fixtures: ['docs/wiki/showcase/W0009-figure-gallery.md'],
})
