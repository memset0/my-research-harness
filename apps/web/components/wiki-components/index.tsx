'use client'

import type { HtmlEmbedV1 } from '../../lib/wiki-components/html-embed@1'
import type { MemonDataV1 } from '../../lib/wiki-components/memon-data@1'
import { HtmlEmbedBlock } from './html-embed@1'
import { MemonDataBlock } from './memon-data@1'

/** Every `name@version` with a renderer in this module. */
const RENDERABLE: Record<string, true> = { 'memon-data@1': true, 'html-embed@1': true }

export const WIKI_COMPONENT_RENDERER_KEYS = Object.keys(RENDERABLE)

/**
 * `true` when a resolved component version can be rendered. The Markdown
 * renderer checks this before replacing the code block, so a descriptor
 * registered without a renderer degrades to a plain fenced block instead of
 * rendering nothing.
 */
export function hasWikiComponentRenderer(name: string, version: number): boolean {
  return `${name}@${version}` in RENDERABLE
}

/**
 * Renderer for one resolved component block. The registry (in `lib`) owns
 * parsing, validation, and version resolution; this component owns nothing
 * but the pairing of a resolved `name@version` with its React renderer, so a
 * new version ships as a new descriptor directory plus one entry here.
 */
export function WikiComponentBlockView({
  name,
  version,
  data,
  assetBase,
}: {
  name: string
  version: number
  data: unknown
  assetBase: string | null
}) {
  switch (`${name}@${version}`) {
    case 'memon-data@1':
      return <MemonDataBlock data={data as MemonDataV1} assetBase={assetBase} />
    case 'html-embed@1':
      return <HtmlEmbedBlock data={data as HtmlEmbedV1} assetBase={assetBase} />
    default:
      return null
  }
}
