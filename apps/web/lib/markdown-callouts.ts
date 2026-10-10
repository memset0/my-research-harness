import type { ProseNode } from './translation/segments'

const TYPES: Record<string, string> = {
  note: 'note',
  abstract: 'abstract',
  summary: 'abstract',
  tldr: 'abstract',
  info: 'info',
  todo: 'todo',
  tip: 'tip',
  hint: 'tip',
  important: 'tip',
  success: 'success',
  check: 'success',
  done: 'success',
  question: 'question',
  help: 'question',
  faq: 'question',
  warning: 'warning',
  caution: 'warning',
  attention: 'warning',
  failure: 'failure',
  fail: 'failure',
  missing: 'failure',
  danger: 'danger',
  error: 'danger',
  bug: 'bug',
  example: 'example',
  quote: 'quote',
  cite: 'quote',
  deprecated: 'deprecated',
}

/** Transform parsed nodes, never interpolate authored text into HTML. */
export function remarkCallouts() {
  return (tree: ProseNode, file: { value: unknown }) => {
    const source = String(file.value)
    const visit = (node: ProseNode) => {
      node.children?.forEach(visit)
      if (node.type !== 'blockquote') return
      const paragraph = node.children?.[0]
      const first = paragraph?.children?.[0]
      if (paragraph?.type !== 'paragraph' || first?.type !== 'text') return
      const offset = first.position?.start.offset
      if (offset === undefined) return
      // Read the literal source: escaped examples stay literal, while underscores
      // inside a custom identifier may have been parsed as inline emphasis.
      const marker = /^\[!([\w-]+)\]([+-]?)[\t ]*/.exec(source.slice(offset))
      if (!marker) return

      const identifier = marker[1]!.toLowerCase()
      const kind = Object.hasOwn(TYPES, identifier) ? TYPES[identifier]! : 'note'
      const fold = marker[2]
      const markerEnd = offset + marker[0].length
      const inline = paragraph.children!.flatMap((child) => {
        if ((child.position?.end.offset ?? Infinity) <= markerEnd) return []
        const start = child.position?.start.offset ?? markerEnd
        return start < markerEnd && child.type === 'text'
          ? [{ ...child, value: child.value!.slice(markerEnd - start) }]
          : [child]
      })
      const { before: title, after: body } = splitFirstLine(inline)
      const customTitle = title.some((part) => part.type !== 'text' || part.value?.trim())
      const titleNode: ProseNode = {
        type: 'paragraph',
        data: {
          hName: fold ? 'summary' : 'div',
          hProperties: {
            className: 'memon-callout-title',
            dataCalloutTitle: kind,
            ...(kind === 'deprecated' && customTitle ? { dataCalloutLabel: 'Deprecated' } : {}),
          },
        },
        children: customTitle ? title : [{ type: 'text', value: titleCase(identifier) }],
      }
      const bodyNodes = [
        ...(body.length ? [{ ...paragraph, children: body }] : []),
        ...node.children!.slice(1),
      ]
      node.data = {
        ...node.data,
        hName: fold ? 'details' : 'div',
        hProperties: {
          ...node.data?.hProperties,
          className: 'memon-callout',
          dataCallout: kind,
          ...(fold === '+' ? { open: 'open' } : {}),
        },
      }
      node.children = [
        titleNode,
        {
          type: 'blockquote',
          data: {
            hName: 'div',
            hProperties: {
              className: 'memon-callout-body',
              ...(bodyNodes.length ? {} : { hidden: 'hidden' }),
            },
          },
          children: bodyNodes,
        },
      ]
    }
    visit(tree)
  }
}

function titleCase(identifier: string): string {
  return identifier.replace(
    /(^|-)(\w)/g,
    (_match, separator: string, letter: string) => `${separator ? ' ' : ''}${letter.toUpperCase()}`,
  )
}

/** Keep inline formatting even when emphasis crosses the title/body boundary. */
function splitFirstLine(nodes: ProseNode[]): {
  before: ProseNode[]
  after: ProseNode[]
  split: boolean
} {
  const before: ProseNode[] = []
  for (const [index, node] of nodes.entries()) {
    if (node.type === 'break') return { before, after: nodes.slice(index + 1), split: true }
    if (node.type === 'text' && node.value?.includes('\n')) {
      const boundary = node.value.indexOf('\n')
      if (boundary) before.push({ ...node, value: node.value.slice(0, boundary) })
      const rest = node.value.slice(boundary + 1)
      return {
        before,
        after: [...(rest ? [{ ...node, value: rest }] : []), ...nodes.slice(index + 1)],
        split: true,
      }
    }
    if (node.children) {
      const nested = splitFirstLine(node.children)
      if (nested.split) {
        if (nested.before.length) before.push({ ...node, children: nested.before })
        return {
          before,
          after: [
            ...(nested.after.length ? [{ ...node, children: nested.after }] : []),
            ...nodes.slice(index + 1),
          ],
          split: true,
        }
      }
    }
    before.push(node)
  }
  return { before, after: [], split: false }
}
