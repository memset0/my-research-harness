/**
 * Fenced-block scanning and emission for the component registry.
 *
 * CommonMark-shaped: a fence opens with three or more backticks or tildes at
 * up to three spaces of indentation, and closes with at least as many of the
 * same character. Content inside a block is never scanned, so a fenced
 * example of a component block does not register as one.
 */

export interface FencedBlock {
  /** Info string of the opening fence, trimmed. */
  info: string
  /** Block body with the opening indentation removed, without a trailing newline. */
  payload: string
  /** 1-based line of the opening fence. */
  line: number
  /** 0-based index of the opening fence line. */
  openIndex: number
  /** 0-based index of the closing fence line, or `lines.length` when unclosed. */
  closeIndex: number
  indent: string
  /** Raw opening fence characters, so a rewrite can reuse them verbatim. */
  fence: string
}

const OPEN_RE = /^( {0,3})(`{3,}|~{3,})(.*)$/

export function scanFencedBlocks(body: string): FencedBlock[] {
  const lines = body.split('\n')
  const blocks: FencedBlock[] = []
  for (let index = 0; index < lines.length; index += 1) {
    const line = (lines[index] as string).replace(/\r$/, '')
    const open = OPEN_RE.exec(line)
    if (!open) continue
    const indent = open[1] as string
    const fence = open[2] as string
    const info = (open[3] as string).trim()
    // A backtick fence's info string may not contain a backtick.
    if (fence.startsWith('`') && info.includes('`')) continue

    const closeRe = new RegExp(`^ {0,3}${fence[0] === '`' ? '`' : '~'}{${fence.length},}\\s*$`)
    let closeIndex = lines.length
    for (let cursor = index + 1; cursor < lines.length; cursor += 1) {
      if (closeRe.test((lines[cursor] as string).replace(/\r$/, ''))) {
        closeIndex = cursor
        break
      }
    }
    const payload = lines
      .slice(index + 1, closeIndex)
      .map((content) => (indent.length > 0 && content.startsWith(indent) ? content.slice(indent.length) : content))
      .join('\n')
    blocks.push({ info, payload, line: index + 1, openIndex: index, closeIndex, indent, fence })
    index = closeIndex
  }
  return blocks
}

/**
 * Backtick fence long enough to wrap `text` — a payload that itself contains
 * a fence needs a longer one, otherwise the projection truncates the block.
 */
export function markdownFenceFor(text: string): string {
  const longest = [...text.matchAll(/`+/g)].reduce(
    (max, match) => Math.max(max, match[0].length),
    0,
  )
  return '`'.repeat(Math.max(3, longest + 1))
}
