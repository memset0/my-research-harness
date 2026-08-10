// Split a README body (without front matter) into top-level (## H2) sections.
//
// We do NOT use a full markdown parser — section boundaries are identified
// purely by lines starting with `## ` at column 0. CommonMark backtick and
// tilde fences are respected so `## Foo` inside a fenced block is not treated
// as a section boundary.

const H2_LINE = /^##\s+(.+)$/
const FENCE_LINE = /^ {0,3}(`{3,}|~{3,})(.*)$/

export interface SectionSplit {
  /** Body before the first H2 (preamble) */
  preamble: string
  /** Map from heading text → body content (without the heading line itself) */
  sections: Map<string, string>
  /** Headings in original order */
  order: string[]
  /**
   * Every H2 occurrence in source order. Unlike `sections`, this array does
   * not collapse duplicate headings. Consumers that must render or preserve
   * malformed/legacy documents losslessly should use this view.
   */
  entries: H2SectionEntry[]
}

export interface H2SectionEntry {
  heading: string
  body: string
  /** Zero-based position among all H2 sections. */
  index: number
  /** One-based occurrence number for this exact heading. */
  occurrence: number
}

export function splitH2Sections(body: string): SectionSplit {
  const lines = body.split('\n')
  const sections = new Map<string, string>()
  const order: string[] = []
  const entries: H2SectionEntry[] = []
  const occurrences = new Map<string, number>()
  const preambleLines: string[] = []
  let currentHeading: string | null = null
  let currentLines: string[] = []
  let fence: { marker: '`' | '~'; length: number } | null = null

  const flush = () => {
    if (currentHeading !== null) {
      // Trim trailing blank lines but keep internal whitespace
      while (currentLines.length > 0 && currentLines[currentLines.length - 1] === '') {
        currentLines.pop()
      }
      sections.set(currentHeading, currentLines.join('\n'))
      order.push(currentHeading)
      const occurrence = (occurrences.get(currentHeading) ?? 0) + 1
      occurrences.set(currentHeading, occurrence)
      entries.push({
        heading: currentHeading,
        body: currentLines.join('\n'),
        index: entries.length,
        occurrence,
      })
    }
  }

  for (const line of lines) {
    const fenceMatch = FENCE_LINE.exec(line)
    if (fenceMatch) {
      const run = fenceMatch[1]!
      const marker = run[0] as '`' | '~'
      if (fence === null) {
        fence = { marker, length: run.length }
      } else if (
        marker === fence.marker &&
        run.length >= fence.length &&
        fenceMatch[2]!.trim() === ''
      ) {
        fence = null
      }
      if (currentHeading === null) {
        preambleLines.push(line)
      } else {
        currentLines.push(line)
      }
      continue
    }
    if (fence === null) {
      const m = H2_LINE.exec(line)
      if (m) {
        flush()
        currentHeading = m[1]!.trim()
        currentLines = []
        continue
      }
    }
    if (currentHeading === null) {
      preambleLines.push(line)
    } else {
      currentLines.push(line)
    }
  }
  flush()

  return {
    preamble: preambleLines.join('\n'),
    sections,
    order,
    entries,
  }
}
