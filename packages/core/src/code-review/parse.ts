// Parse + mutate code-review docs.
//
// A code-review doc is YAML frontmatter (the machine-read contract) followed
// by an opaque markdown body. The runtime reads the frontmatter for the list
// / detail / completion, and toggles single progress booleans on write while
// preserving the body BYTE-FOR-BYTE. We split + re-dump frontmatter via
// js-yaml (JSON_SCHEMA, matching `yaml-engine`) and concatenate the original
// body untouched — gray-matter's content-normalization is deliberately
// avoided on the write path.

import yaml from 'js-yaml'
import { splitFrontmatter } from '../frontmatter.js'
import { CodeReviewFrontMatterRawSchema } from '../schemas.js'
import type { CodeReviewCompletion, CodeReviewFrontMatter } from '../types.js'

export interface SplitCodeReview {
  /** Raw YAML mapping (snake_case, as written). */
  data: Record<string, unknown>
  /** Everything after the closing delimiter, byte-for-byte. */
  body: string
}

/**
 * Split a doc into its frontmatter object + verbatim body. Returns null when
 * the content has no leading `---` frontmatter block, the YAML is invalid, or
 * the frontmatter is not a mapping.
 */
export function splitCodeReviewFrontmatter(content: string): SplitCodeReview | null {
  const split = splitFrontmatter(content)
  if (split.status !== 'ok') return null
  let data: unknown
  try {
    data = yaml.load(split.raw, { schema: yaml.JSON_SCHEMA })
  } catch {
    return null
  }
  if (data == null) data = {}
  if (typeof data !== 'object' || Array.isArray(data)) return null
  return { data: data as Record<string, unknown>, body: split.body }
}

export interface ParsedCodeReview {
  frontmatter: CodeReviewFrontMatter
  body: string
}

/**
 * Parse + validate a code-review doc into camelCase frontmatter + body.
 * THROWS on missing/malformed frontmatter so the caller (DirCache parseFile)
 * skips the file rather than surfacing a broken entry.
 */
export function parseCodeReview(content: string): ParsedCodeReview {
  const split = splitCodeReviewFrontmatter(content)
  if (!split) throw new Error('code-review: missing or malformed frontmatter')
  const raw = CodeReviewFrontMatterRawSchema.parse(split.data)
  return {
    frontmatter: {
      title: raw.title,
      description: raw.description,
      experiment: raw.experiment,
      createdAt: raw.created_at,
      updatedAt: raw.updated_at,
      commits: raw.commits.map((c) => ({
        repo: c.repo,
        sha: c.sha,
        url: c.url,
        ...(c.subject !== undefined ? { subject: c.subject } : {}),
        reviewed: c.reviewed,
      })),
      reviewTodolist: raw.review_todolist.map((t) => ({ item: t.item, done: t.done })),
    },
    body: split.body,
  }
}

/** Derive the completion summary. An empty review is NOT complete. */
export function deriveCompletion(fm: CodeReviewFrontMatter): CodeReviewCompletion {
  const totalCommits = fm.commits.length
  const reviewedCommits = fm.commits.filter((c) => c.reviewed).length
  const totalTodos = fm.reviewTodolist.length
  const doneTodos = fm.reviewTodolist.filter((t) => t.done).length
  const isComplete =
    totalCommits + totalTodos > 0 && reviewedCommits === totalCommits && doneTodos === totalTodos
  return { totalCommits, reviewedCommits, totalTodos, doneTodos, isComplete }
}

function reserialize(data: Record<string, unknown>, body: string): string {
  // lineWidth -1 disables wrapping so long GitHub URLs stay on one line.
  const fm = yaml.dump(data, { schema: yaml.JSON_SCHEMA, lineWidth: -1 })
  return `---\n${fm}---\n${body}`
}

/**
 * Flip one commit's `reviewed` flag (matched by `sha`), bump `updated_at`, and
 * re-serialize — body preserved byte-for-byte. Returns null on malformed
 * content or when no commit has that sha.
 */
export function toggleCommitReviewed(
  content: string,
  sha: string,
  reviewed: boolean,
  nowIso: string,
): string | null {
  const split = splitCodeReviewFrontmatter(content)
  if (!split) return null
  const commits = split.data.commits
  if (!Array.isArray(commits)) return null
  const target = commits.find(
    (c): c is Record<string, unknown> =>
      !!c && typeof c === 'object' && (c as Record<string, unknown>).sha === sha,
  )
  if (!target) return null
  target.reviewed = reviewed
  split.data.updated_at = nowIso
  return reserialize(split.data, split.body)
}

/**
 * Flip one todolist item's `done` flag (by index), bump `updated_at`, and
 * re-serialize — body preserved. Returns null on malformed content or an
 * out-of-range index.
 */
export function toggleTodoDone(
  content: string,
  index: number,
  done: boolean,
  nowIso: string,
): string | null {
  const split = splitCodeReviewFrontmatter(content)
  if (!split) return null
  const todos = split.data.review_todolist
  if (!Array.isArray(todos)) return null
  if (!Number.isInteger(index) || index < 0 || index >= todos.length) return null
  const target = todos[index]
  if (!target || typeof target !== 'object') return null
  ;(target as Record<string, unknown>).done = done
  split.data.updated_at = nowIso
  return reserialize(split.data, split.body)
}
