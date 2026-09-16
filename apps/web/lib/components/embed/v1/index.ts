import { z } from 'zod'
import { defineComponent } from '../../types'

const schema = z.object({
  data: z.string().min(1).describe('Trusted HTML document or fragment rendered in a same-origin iframe.'),
  height: z.union([z.number().int().positive(), z.literal('auto')]).default('auto').describe('Iframe height in positive integer pixels, or `auto` to measure its content.'),
  title: z.string().min(1).optional().describe('Accessible title shown in the embed toolbar and used for the iframe.'),
})

const example = [
  '```html embed@1 #interactive_chart',
  '<!doctype html>',
  '<title>Training loss</title>',
  '<p>Interactive chart</p>',
  '```',
].join('\n')

export const descriptor = defineComponent({
  type: 'embed',
  version: 1,
  description: 'Trusted HTML rendered in a same-origin iframe with the shared report toolbar.',
  useWhen: 'Use for an interactive chart or self-contained HTML view. Put `title`/`height` in a YAML payload when they matter, or use an `html embed@1` fence for the simplest `{data}` form. Use `figure@1` for a static image and `datatable@1` when the source numbers should remain directly readable.',
  schema,
  example,
  invalidExamples: [
    { block: ['```yaml embed@1 #empty', 'data: ""', '```'].join('\n'), code: 'WIKI_COMPONENT_INVALID' },
    { block: ['```yaml embed@1 #height', 'data: <p>x</p>', 'height: 0', '```'].join('\n'), code: 'WIKI_COMPONENT_INVALID' },
  ],
  fixtures: [
    'docs/wiki/decision/W0003-adopt-bf16-flow-matching.md',
    'docs/wiki/showcase/W0006-edm2-precond-explorer/README.md',
  ],
})
