export interface ProseNode {
  type: string
  value?: string
  url?: string
  title?: string | null
  identifier?: string
  data?: { hName?: string; hProperties?: Record<string, string> }
  children?: ProseNode[]
  position?: { start: { offset?: number }; end: { offset?: number } }
}

export interface TranslationSegment {
  id: string
  sourceHash: string
  text: string
  tokens: { open: string; close?: string }[]
}

export function sourceKey(source: string): string {
  let hash = 14695981039346656037n
  for (const character of source) {
    hash ^= BigInt(character.codePointAt(0)!)
    hash = BigInt.asUintN(64, hash * 1099511628211n)
  }
  return hash.toString(16)
}

export function escapeProse(text: string): string {
  return text.replace(/[\\`*_{}\[\]<>~!$#|+\-.()=]/g, '\\$&')
}

export function removeGeneratedAutolinks(tree: ProseNode, source: string): void {
  if (!tree.children) return
  tree.children = tree.children.flatMap((child) => {
    removeGeneratedAutolinks(child, source)
    if (child.type === 'link' && source[child.position?.start.offset ?? -1] !== '[')
      return child.children ?? []
    return [child]
  })
}

export function literalSegment(text: string): TranslationSegment | null {
  return makeSegment(
    { type: 'paragraph', children: [{ type: 'text', value: text }] },
    `literal:${text}`,
    'literal',
  )
}

export function makeSegment(
  node: ProseNode,
  source: string,
  key: string,
): TranslationSegment | null {
  const tokens: TranslationSegment['tokens'] = []
  let prose = ''
  const protect = (open: string, close?: string, content?: string) => {
    const index = tokens.length
    tokens.push({ open, ...(close === undefined ? {} : { close }) })
    return close === undefined ? `[[${index}]]` : `[[${index}]]${content ?? ''}[[/${index}]]`
  }
  const original = (child: ProseNode) => {
    const start = child.position?.start.offset
    const end = child.position?.end.offset
    if (start === undefined || end === undefined) throw new Error('Unsupported inline object')
    return source.slice(start, end)
  }
  const visit = (child: ProseNode): string => {
    if (child.type === 'text') {
      return (child.value ?? '')
        .split(
          /((?:https?:\/\/|www\.)\S+|\b[A-Z]{1,4}\d{4}(?:-[a-z0-9-]+)?\b|\b\d+(?:\.\d+)?(?:%|ms|s)?\b|\[\[\/?\d+\]\])/g,
        )
        .map((part, index) => {
          if (index % 2) return protect(escapeProse(part))
          prose += part
          return part
        })
        .join('')
    }
    if (['inlineCode', 'inlineMath', 'image'].includes(child.type)) return protect(original(child))
    if (child.type === 'break') return protect('  \n')
    if (['emphasis', 'strong', 'delete', 'link'].includes(child.type)) {
      const index = tokens.length
      let open = child.type === 'strong' ? '**' : child.type === 'delete' ? '~~' : '*'
      let close = open
      if (child.type === 'link') {
        if (
          !child.url ||
          /[<>\r\n]/.test(child.url) ||
          /^(?:javascript|data|vbscript):/i.test(child.url)
        )
          throw new Error('Unsupported link')
        open = '['
        close = `](<${child.url}>)`
      }
      tokens.push({ open, close })
      return `[[${index}]]${(child.children ?? []).map(visit).join('')}[[/${index}]]`
    }
    throw new Error('Unsupported inline node')
  }
  try {
    const text = (node.children ?? []).map(visit).join('')
    if (!/[A-Za-z]{2}/.test(prose) || !text.trim()) return null
    const hash = sourceKey(JSON.stringify({ text, tokens }))
    return { id: `${sourceKey(source)}:${key}`, sourceHash: hash, text, tokens }
  } catch {
    return null
  }
}

export function segmentMarkdownTree(
  tree: ProseNode,
  source: string,
  decorate = false,
): TranslationSegment[] {
  const segments: TranslationSegment[] = []
  const definitions = new Map<string, ProseNode>()
  const discover = (node: ProseNode) => {
    if (node.type === 'definition' && node.identifier)
      definitions.set(node.identifier.toLowerCase(), node)
    node.children?.forEach(discover)
  }
  discover(tree)
  const resolve = (node: ProseNode): ProseNode => {
    const definition = node.identifier && definitions.get(node.identifier.toLowerCase())
    if (node.type === 'linkReference' && definition)
      return { ...node, type: 'link', url: definition.url }
    if (node.type === 'imageReference') return { ...node, type: 'image' }
    return { ...node, children: node.children?.map(resolve) }
  }
  const visit = (node: ProseNode, path: string) => {
    if (['code', 'math', 'html', 'definition'].includes(node.type)) return
    if (['paragraph', 'heading', 'tableCell'].includes(node.type)) {
      const segment = makeSegment(resolve(node), source, path)
      if (segment) {
        for (const part of splitSegment(segment)) {
          segments.push(part)
          if (decorate)
            node.children!.push({
              type: 'memonTranslation',
              data: { hName: 'span', hProperties: { dataMemonTranslation: part.id } },
            })
        }
      }
      return
    }
    node.children?.forEach((child, index) => {
      visit(child, `${path}.${index}`)
    })
  }
  visit(tree, 'body')
  return segments
}

export function reconstructTranslation(segment: TranslationSegment, output: string): string | null {
  if (!output.trim() || output.length > 32_000) return null
  const seen = new Set<string>()
  const stack: number[] = []
  const chunks = output.split(/(\[\[\/?\d+\]\])/g)
  let result = ''
  for (const chunk of chunks) {
    const match = /^\[\[(\/?)(\d+)\]\]$/.exec(chunk)
    if (!match) {
      result += escapeProse(chunk)
      continue
    }
    const index = Number(match[2])
    const token = segment.tokens[index]
    if (!token || seen.has(chunk)) return null
    seen.add(chunk)
    if (match[1]) {
      if (token.close === undefined || stack.pop() !== index) return null
      result += token.close
    } else {
      result += token.open
      if (token.close !== undefined) stack.push(index)
    }
  }
  if (stack.length) return null
  if (
    segment.tokens.some(
      (token, index) =>
        !seen.has(`[[${index}]]`) || (token.close !== undefined && !seen.has(`[[/${index}]]`)),
    )
  )
    return null
  return result
}

export const BATCH_ITEMS = 24
export const BATCH_BYTES = 12_000

export function splitSegment(segment: TranslationSegment): TranslationSegment[] {
  const size = (text: string) =>
    new TextEncoder().encode(JSON.stringify({ id: segment.id + ':part0000', text })).length + 2
  if (size(segment.text) <= BATCH_BYTES) return [segment]
  const chunks: string[] = []
  let pending = ''
  let unit = ''
  let depth = 0
  for (const token of segment.text.split(/(\[\[\/?\d+\]\]|\s+)/g)) {
    const marker = /^\[\[(\/?)(\d+)\]\]$/.exec(token)
    if (marker && segment.tokens[Number(marker[2])]?.close !== undefined)
      depth += marker[1] ? -1 : 1
    unit += token
    if (depth === 0 && /^\s+$/.test(token)) {
      if (pending && size(pending + unit) > BATCH_BYTES) {
        chunks.push(pending)
        pending = ''
      }
      pending += unit
      unit = ''
    }
  }
  if (pending && size(pending + unit) > BATCH_BYTES) {
    chunks.push(pending)
    pending = ''
  }
  if (pending + unit) chunks.push(pending + unit)
  return chunks.map((text, part) => {
    const indexes = [
      ...new Set([...text.matchAll(/\[\[\/?(\d+)\]\]/g)].map((match) => Number(match[1]))),
    ]
    const tokens = indexes.map((index) => segment.tokens[index]!)
    const remapped = text.replace(
      /\[\[(\/?)(\d+)\]\]/g,
      (_match, closing: string, index: string) => `[[${closing}${indexes.indexOf(Number(index))}]]`,
    )
    return {
      id: `${segment.id}:part${part}`,
      sourceHash: sourceKey(JSON.stringify({ text: remapped, tokens })),
      text: remapped,
      tokens,
    }
  })
}

export function packSegments(segments: TranslationSegment[]): {
  batches: TranslationSegment[][]
  oversized: string[]
} {
  const batches: TranslationSegment[][] = []
  const oversized: string[] = []
  let batch: TranslationSegment[] = []
  let bytes = 2
  for (const segment of segments) {
    const length =
      new TextEncoder().encode(JSON.stringify({ id: segment.id, text: segment.text })).length + 1
    if (length > BATCH_BYTES - 2) {
      oversized.push(segment.id)
      continue
    }
    if (batch.length >= BATCH_ITEMS || bytes + length > BATCH_BYTES) {
      batches.push(batch)
      batch = []
      bytes = 2
    }
    batch.push(segment)
    bytes += length
  }
  if (batch.length) batches.push(batch)
  return { batches, oversized }
}
