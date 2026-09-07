/**
 * Heading outline for a Markdown body, matching the ids the shared Markdown
 * renderer assigns when `tableOfContents` is enabled.
 *
 * The wiki reading surface shows the outline in a sticky column beside the
 * body instead of only inside it, so the entries have to be derivable without
 * rendering. Both sides use the same prefix + slug + occurrence rules, so a
 * link generated here always resolves to a rendered anchor.
 */

export interface MarkdownOutlineEntry {
  depth: number
  id: string
  label: string
}

export interface MarkdownOutlineOptions {
  headingIdPrefix: string
  minDepth?: number
  maxDepth?: number
}

/**
 * Canonical heading-id helpers, shared with the Markdown renderer.
 *
 * They live here rather than in `markdown.tsx` so the sticky outline column
 * and the rendered anchors cannot drift apart: one implementation, two
 * consumers.
 */
export function normalizeHeadingIdPrefix(value: string): string {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return normalized ? `${normalized}-` : 'report-'
}

export function markdownHeadingSlug(value: string): string {
  const slug = value
    .normalize('NFKC')
    .trim()
    .toLowerCase()
    .replace(/[^\p{Letter}\p{Number}\s-]/gu, '')
    .replace(/[\s-]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return slug || 'section'
}

const ATX_HEADING = /^(#{1,6})[ \t]+(.*?)[ \t]*#*[ \t]*$/
const FENCE = /^\s{0,3}(`{3,}|~{3,})/

/**
 * ATX headings outside fenced code blocks, in document order.
 *
 * Setext headings are deliberately ignored: the wiki templates and every
 * fixture use ATX, and a line-based scan cannot tell a `---` underline from a
 * thematic break or a frontmatter fence without a full parse.
 */
export function extractMarkdownOutline(
  body: string,
  options: MarkdownOutlineOptions,
): MarkdownOutlineEntry[] {
  const minDepth = Math.max(1, Math.min(6, options.minDepth ?? 2))
  const maxDepth = Math.max(minDepth, Math.min(6, options.maxDepth ?? 6))
  const prefix = normalizeHeadingIdPrefix(options.headingIdPrefix)
  const occurrences = new Map<string, number>()
  const entries: MarkdownOutlineEntry[] = []
  let openFence: string | null = null

  for (const line of body.split('\n')) {
    const fence = FENCE.exec(line)
    if (openFence !== null) {
      const marker = fence?.[1]
      if (marker && marker[0] === openFence[0] && marker.length >= openFence.length) {
        openFence = null
      }
      continue
    }
    if (fence) {
      openFence = fence[1]!
      continue
    }
    const heading = ATX_HEADING.exec(line)
    if (!heading) continue

    const depth = heading[1]!.length
    const label = heading[2]!.trim() || 'Section'
    // Every heading consumes an occurrence slot, including the H1 the outline
    // itself omits, so the ids stay identical to the renderer's.
    const baseId = `${prefix}${markdownHeadingSlug(label)}`
    const occurrence = occurrences.get(baseId) ?? 0
    occurrences.set(baseId, occurrence + 1)
    const id = occurrence === 0 ? baseId : `${baseId}-${occurrence}`
    if (depth >= minDepth && depth <= maxDepth) entries.push({ depth, id, label })
  }

  return entries
}
