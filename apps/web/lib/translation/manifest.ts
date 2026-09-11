import { createHash } from 'node:crypto'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import remarkParse from 'remark-parse'
import { unified } from 'unified'
import { resolveComponentBlock } from '../wiki-components/registry'
import {
  literalSegment,
  segmentMarkdownTree,
  type ProseNode,
  type TranslationSegment,
} from './segments'
import type { TranslationSource } from './sources'

export function createTranslationManifest(sources: TranslationSource[]) {
  const segments = new Map<string, TranslationSegment>()
  const add = (segment: TranslationSegment | null) => {
    if (!segment) return
    const previous = segments.get(segment.id)
    if (previous && JSON.stringify(previous) !== JSON.stringify(segment))
      throw new Error('Segment identity collision')
    segments.set(segment.id, segment)
  }
  const processor = unified().use(remarkParse).use(remarkGfm).use(remarkMath)
  for (const source of sources) {
    if (source.format === 'literal') {
      add(literalSegment(source.text))
      continue
    }
    const tree = processor.runSync(processor.parse(source.text)) as ProseNode
    segmentMarkdownTree(tree, source.text).forEach(add)
    const captions = (node: ProseNode & { lang?: string }) => {
      if (node.type === 'code' && node.lang === 'figure@1' && node.value) {
        const block = resolveComponentBlock({ info: node.lang, payload: node.value })
        if (
          block &&
          'data' in block &&
          typeof (block.data as { caption?: unknown })?.caption === 'string'
        )
          add(literalSegment((block.data as { caption: string }).caption))
      }
      node.children?.forEach(captions)
    }
    captions(tree)
  }
  return {
    revision: createHash('sha256').update(JSON.stringify(sources)).digest('hex'),
    segments: [...segments.values()],
  }
}
