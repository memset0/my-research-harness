/**
 * `html-embed@1` — agent-authored HTML rendered as a same-origin `srcdoc`
 * iframe inside the shared embed toolbar.
 *
 * The payload is the HTML document (or fragment) verbatim. On a bundle page
 * the renderer injects a `<base href>` pointing at the page asset route so
 * `./data/*` and `./views/*` requests inside the block resolve.
 */

import { z } from 'zod'
import { markdownFenceFor } from '../fence'
import { formatWikiComponentInfoString } from '../parse-info-string'
import {
  parseComponentAttributes,
  WikiComponentBlockError,
  type WikiComponentDescriptor,
} from '../types'

export interface HtmlEmbedV1 {
  html: string
  /** Explicit pixel height, or `auto` to size the iframe to its content. */
  height: number | 'auto'
  title: string | null
}

const MAX_HEIGHT_PX = 4000

const attributes = z
  .object({ height: z.string().optional(), title: z.string().min(1).optional() })
  .strict('only the `height` and `title` attributes are accepted')

function parsePayload(payload: string, rawAttributes: Record<string, string>): HtmlEmbedV1 {
  const attrs = parseComponentAttributes(
    { name: 'html-embed', version: 1, attributes },
    rawAttributes,
  )

  let height: number | 'auto' = 'auto'
  if (attrs.height !== undefined && attrs.height !== 'auto') {
    if (!/^[1-9][0-9]*$/.test(attrs.height) || Number(attrs.height) > MAX_HEIGHT_PX) {
      throw new WikiComponentBlockError(
        'WIKI_COMPONENT_INVALID',
        'height',
        `must be a pixel count between 1 and ${MAX_HEIGHT_PX} or \`auto\`, got \`${attrs.height}\``,
      )
    }
    height = Number(attrs.height)
  }

  if (payload.trim().length === 0) {
    throw new WikiComponentBlockError(
      'WIKI_COMPONENT_INVALID',
      null,
      'payload is empty; the block body is the embedded document',
    )
  }

  return { html: payload, height, title: attrs.title ?? null }
}

export const htmlEmbedV1: WikiComponentDescriptor<HtmlEmbedV1> = {
  name: 'html-embed',
  version: 1,
  description:
    'A block of agent-authored HTML — chart, widget, or styled table — rendered in an iframe with the shared embed toolbar.',
  args: [
    {
      name: 'height',
      scope: 'attribute',
      type: 'positive integer (px) | "auto"',
      required: false,
      default: 'auto',
      meaning: `Fixed iframe height in pixels, or \`auto\` to grow with the document (capped at ${MAX_HEIGHT_PX}px).`,
    },
    {
      name: 'title',
      scope: 'attribute',
      type: 'string',
      required: false,
      meaning: 'Label shown in the embed toolbar and used as the iframe accessible name.',
    },
    {
      name: '<body>',
      scope: 'payload',
      type: 'HTML document',
      required: true,
      meaning:
        'The document loaded into the iframe via `srcdoc`. Scripts run (same-origin, trusted agent-authored content); CDN libraries and, on a bundle page, `./`-relative bundle assets are available.',
    },
  ],
  effect:
    'The dashboard renders the payload as a same-origin `srcdoc` iframe inside the embed toolbar (zoom, reload, expand, mobile menu). On a bundle page a `<base href>` for the page asset route is injected so relative asset requests resolve; without an asset base only inline and CDN resources load. Outside the dashboard the block stays a plain fenced code block.',
  useWhen:
    'Use it for anything that must be drawn or interacted with: charts, small explorers, custom layouts. Do not use it for tabular numbers (use `memon-data@1`, which keeps the provenance) or for a static picture that a Markdown image would show just as well.',
  example: [
    '```html-embed@1 height=280 title="FID by step"',
    '<script src="https://cdn.jsdelivr.net/npm/d3@7"></script>',
    '<div id="chart"></div>',
    '<script>',
    "fetch('./data/fid.csv').then(r => r.text()).then(text => {",
    "  document.getElementById('chart').textContent = text.split('\\n').length + ' rows';",
    '});',
    '</script>',
    '```',
  ].join('\n'),
  invalidExamples: [
    {
      code: 'WIKI_COMPONENT_INVALID',
      block: ['```html-embed@1 height=tall', '<div>chart</div>', '```'].join('\n'),
    },
    {
      code: 'WIKI_COMPONENT_INVALID',
      block: ['```html-embed@1 width=600', '<div>chart</div>', '```'].join('\n'),
    },
    {
      code: 'WIKI_COMPONENT_INVALID',
      block: ['```html-embed@1 height=320', '', '```'].join('\n'),
    },
  ],
  fixtures: [
    'mock/project-a/docs/wiki/decision/W0003-adopt-bf16-flow-matching.md',
    'mock/project-a/docs/wiki/showcase/W0006-edm2-precond-explorer/README.md',
  ],
  attributes,
  parsePayload,
  lint: () => [],
  toMarkdown: (data) => {
    const attrs: Record<string, string> = {}
    if (data.height !== 'auto') attrs.height = String(data.height)
    if (data.title) attrs.title = data.title
    const html = data.html.replace(/\n$/, '')
    const fence = markdownFenceFor(html)
    return [
      `${fence}${formatWikiComponentInfoString('html-embed', 1, attrs)}`,
      html,
      fence,
    ].join('\n')
  },
}
