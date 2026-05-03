// Split a README body (without front matter) into top-level (## H2) sections.
//
// We do NOT use a full markdown parser — section boundaries are identified
// purely by lines starting with `## ` at column 0. Code fences (```) are
// respected so that `## Foo` inside a fenced block is not treated as a section
// boundary.

const H2_LINE = /^##\s+(.+)$/
const FENCE_LINE = /^```/

export interface SectionSplit {
  /** Body before the first H2 (preamble) */
  preamble: string
  /** Map from heading text → body content (without the heading line itself) */
  sections: Map<string, string>
  /** Headings in original order */
  order: string[]
}

export function splitH2Sections(body: string): SectionSplit {
  const lines = body.split('\n')
  const sections = new Map<string, string>()
  const order: string[] = []
  const preambleLines: string[] = []
  let currentHeading: string | null = null
  let currentLines: string[] = []
  let inFence = false

  const flush = () => {
    if (currentHeading !== null) {
      // Trim trailing blank lines but keep internal whitespace
      while (currentLines.length > 0 && currentLines[currentLines.length - 1] === '') {
        currentLines.pop()
      }
      sections.set(currentHeading, currentLines.join('\n'))
      order.push(currentHeading)
    }
  }

  for (const line of lines) {
    if (FENCE_LINE.test(line)) {
      inFence = !inFence
      if (currentHeading === null) {
        preambleLines.push(line)
      } else {
        currentLines.push(line)
      }
      continue
    }
    if (!inFence) {
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
  }
}
