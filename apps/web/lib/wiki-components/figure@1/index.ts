import { CORE_SCHEMA, load as loadYaml, dump as dumpYaml } from 'js-yaml'
import { z } from 'zod'
import { markdownFenceFor } from '../fence'
import {
  parseComponentAttributes,
  WikiComponentBlockError,
  type WikiComponentDescriptor,
} from '../types'

export interface FigureV1 {
  slug: string
  src: string
  caption: string
  description: string
}

const attributes = z.object({}).strict()
const payloadSchema = z
  .object({
    slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
    src: z.string().regex(/^assets\/[a-z0-9]+(?:-[a-z0-9]+)*\.(?:svg|png|jpe?g|webp|gif|avif)$/),
    caption: z.string().trim().min(1),
    description: z.string().trim().min(1),
  })
  .strict()

function parsePayload(payload: string, rawAttributes: Record<string, string>): FigureV1 {
  parseComponentAttributes({ name: 'figure', version: 1, attributes }, rawAttributes)
  let document: unknown
  try {
    document = loadYaml(payload, { schema: CORE_SCHEMA })
  } catch {
    throw new WikiComponentBlockError('WIKI_COMPONENT_INVALID', null, 'payload must be valid YAML')
  }
  const result = payloadSchema.safeParse(document)
  if (!result.success) {
    const issue = result.error.issues[0]!
    const field = issue.code === 'unrecognized_keys' ? issue.keys[0] : issue.path[0]
    throw new WikiComponentBlockError(
      'WIKI_COMPONENT_INVALID',
      typeof field === 'string' ? field : null,
      issue.message,
    )
  }
  const data = result.data
  if (data.src.slice('assets/'.length).split('.')[0] !== data.slug) {
    throw new WikiComponentBlockError(
      'WIKI_COMPONENT_INVALID',
      'src',
      'image basename must match slug',
    )
  }
  return data
}

const example = [
  '```figure@1',
  'slug: pipeline-overview',
  'src: assets/pipeline-overview.svg',
  'caption: Figure 1. A three-stage processing pipeline.',
  'description: Three labeled boxes, Input, Process, and Output, connected by left-to-right arrows.',
  '```',
].join('\n')

export const figureV1: WikiComponentDescriptor<FigureV1> = {
  name: 'figure',
  version: 1,
  description: 'A local image with a visible figure caption and an agent-readable description.',
  args: [
    {
      name: 'slug',
      scope: 'payload',
      type: 'kebab-case string',
      required: true,
      meaning:
        'Descriptive lowercase image identity; must match the image filename without extension.',
    },
    {
      name: 'src',
      scope: 'payload',
      type: 'assets/<slug>.<extension>',
      required: true,
      meaning:
        'Image under docs/wiki/assets in this project. Extensions: svg, png, jpg, jpeg, webp, gif, avif. No URLs, inline image data, or nested paths.',
    },
    {
      name: 'caption',
      scope: 'payload',
      type: 'nonempty string',
      required: true,
      meaning:
        'Plain text displayed below the image. Include a figure number or source credit here when desired.',
    },
    {
      name: 'description',
      scope: 'payload',
      type: 'nonempty string',
      required: true,
      meaning:
        'Accurate description of image contents for agents reading Markdown and for image alternative text; not a duplicate visible caption.',
    },
  ],
  effect:
    'Renders a responsive image and visible figcaption. Description becomes alt text. Shared images work for single-file and bundle wiki pages, and other Markdown surfaces with project context. SVG is loaded as an image, not injected markup. Without project context or on load failure, a readable fallback retains caption and description. Text projection preserves the fenced payload.',
  useWhen:
    'Use for agent-drawn self-contained SVG or user-provided/authorized images requiring a caption and description. Save the image in docs/wiki/assets first; preserve supplied bytes unless asked to transform them. Do not download unapproved images or hotlink. Inspect the local image and rendered result; use html-embed for interactive graphics instead.',
  example,
  invalidExamples: [
    {
      block: example.replace(
        'assets/pipeline-overview.svg',
        'https://example.com/pipeline-overview.svg',
      ),
      code: 'WIKI_COMPONENT_INVALID',
    },
    {
      block: example.replace('slug: pipeline-overview', 'slug: other-diagram'),
      code: 'WIKI_COMPONENT_INVALID',
    },
    { block: example.replace(/^description:.*\n/m, ''), code: 'WIKI_COMPONENT_INVALID' },
  ],
  fixtures: ['mock/project-a/docs/wiki/showcase/W0009-figure-gallery.md'],
  attributes,
  parsePayload,
  lint: () => [],
  toMarkdown(data) {
    const payload = dumpYaml(data, { lineWidth: -1, noRefs: true }).trimEnd()
    const fence = markdownFenceFor(payload)
    return `${fence}figure@1\n${payload}\n${fence}`
  },
}
