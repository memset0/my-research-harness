// Extract the first H1 heading text from a markdown body. Used by the
// reports / digests inbox views to label list entries; also useful for any
// future feature that needs a "what is this document about?" summary.
//
// Rules (intentionally permissive):
//   - First line matching `^#\s+(.+)$` (column 0) wins.
//   - Code fences (```) are respected — `# Foo` inside a fence is ignored.
//   - YAML front matter blocks (between `---` lines starting at line 1) are
//     skipped before scanning.
//   - Returns null when no H1 is found.

const H1_LINE = /^#\s+(.+)$/
const FENCE_LINE = /^```/
const YAML_FENCE = /^---\s*$/

export function extractTitle(content: string): string | null {
  const lines = content.split('\n')

  // Skip YAML frontmatter (--- … ---) at top of file.
  let start = 0
  if (lines.length > 0 && YAML_FENCE.test(lines[0]!)) {
    for (let i = 1; i < lines.length; i++) {
      if (YAML_FENCE.test(lines[i]!)) {
        start = i + 1
        break
      }
    }
  }

  let inFence = false
  for (let i = start; i < lines.length; i++) {
    const line = lines[i]!
    if (FENCE_LINE.test(line)) {
      inFence = !inFence
      continue
    }
    if (inFence) continue
    const m = H1_LINE.exec(line)
    if (m) return m[1]!.trim()
  }
  return null
}
