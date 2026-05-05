import { load } from 'js-yaml'

export interface FrontmatterSplit {
  frontmatter: Record<string, unknown> | null
  body: string
}

const FENCE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/

export function splitFrontmatter(content: string): FrontmatterSplit {
  const match = content.match(FENCE)
  if (!match || match[1] === undefined) return { frontmatter: null, body: content }
  try {
    const parsed = load(match[1])
    if (parsed === null || parsed === undefined) {
      return { frontmatter: null, body: content }
    }
    if (typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { frontmatter: null, body: content }
    }
    return {
      frontmatter: parsed as Record<string, unknown>,
      body: content.slice(match[0].length),
    }
  } catch {
    return { frontmatter: null, body: content }
  }
}
