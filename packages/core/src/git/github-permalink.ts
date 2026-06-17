// Parse a GitHub blob line-permalink and slice a context window out of file
// content. Used by the dashboard's local code-preview (no GitHub network): the
// permalink names owner/repo/sha/path + a line range; the caller maps owner/repo
// to a local repo and reads the file at <sha>:<path>, then `sliceContext` builds
// the previewed window with the target lines flagged.

export interface GithubPermalink {
  owner: string
  repo: string
  /** The ref in the /blob/<ref>/ segment — normally a full commit sha. */
  sha: string
  /** File path relative to the repo root. */
  path: string
  startLine: number
  endLine: number
}

// https://github.com/<owner>/<repo>/blob/<sha>/<path>#L<a>[-L<b>]
const PERMALINK_RE =
  /^https?:\/\/github\.com\/([^/\s]+)\/([^/\s]+)\/blob\/([^/\s]+)\/([^#\s]+?)#L(\d+)(?:-L(\d+))?$/

/**
 * Parse a GitHub blob line-permalink. Returns null for anything that is not a
 * github.com `/blob/<ref>/<path>#L..` URL (e.g. commit URLs, links with no
 * line anchor, non-github hosts, inverted ranges).
 */
export function parseGithubPermalink(url: string): GithubPermalink | null {
  if (typeof url !== 'string') return null
  const m = PERMALINK_RE.exec(url.trim())
  if (!m) return null
  const [, owner, repo, sha, rawPath, a, b] = m
  const startLine = Number(a)
  const endLine = b ? Number(b) : startLine
  if (!Number.isInteger(startLine) || startLine < 1) return null
  if (!Number.isInteger(endLine) || endLine < startLine) return null
  // Drop a trailing ?plain=1 (or any query) that can sit before the #anchor.
  let path: string
  try {
    path = decodeURIComponent((rawPath ?? '').split('?')[0] ?? '')
  } catch {
    path = (rawPath ?? '').split('?')[0] ?? ''
  }
  if (!path) return null
  return { owner: owner!, repo: repo!, sha: sha!, path, startLine, endLine }
}

export interface PreviewLine {
  /** 1-based line number in the file. */
  n: number
  text: string
  /** True for the lines the permalink points at. */
  target: boolean
}

export interface CodeContext {
  /** First line number shown. */
  startLine: number
  /** Last line number shown. */
  endLine: number
  lines: PreviewLine[]
  /** True when the window was capped at `maxLines`. */
  truncated: boolean
}

/**
 * Slice `[targetStart - ctx, targetEnd + ctx]` out of `content` (clamped to the
 * file), capped at `maxLines`. Each returned line carries its 1-based number and
 * a `target` flag for the permalink's referenced range.
 */
export function sliceContext(
  content: string,
  targetStart: number,
  targetEnd: number,
  ctx = 12,
  maxLines = 400,
): CodeContext {
  const all = content.split('\n')
  const total = all.length
  const from = Math.max(1, targetStart - ctx)
  let to = Math.min(total, targetEnd + ctx)
  let truncated = false
  if (to - from + 1 > maxLines) {
    to = from + maxLines - 1
    truncated = true
  }
  const lines: PreviewLine[] = []
  for (let n = from; n <= to; n++) {
    lines.push({ n, text: all[n - 1] ?? '', target: n >= targetStart && n <= targetEnd })
  }
  return { startLine: from, endLine: to, lines, truncated }
}
