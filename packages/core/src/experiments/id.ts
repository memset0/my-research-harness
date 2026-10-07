// Experiment id allocation and slug↔id resolution.
//
// IDs are `E<NNNN>-<slug>` where `<NNNN>` is 4-digit zero-padded, monotonically
// assigned per project. Allocation is lock-free; callers retry on EEXIST.
//
// On disk (post-v5) each experiment lives at
// `<projectRoot>/docs/experiments/E<NNNN>-<slug>/README.md`. For the v4→v5
// migration window we also accept the legacy file form
// `<projectRoot>/docs/experiments/E<NNNN>-<slug>.md` so allocation stays
// monotonic when both shapes coexist briefly.

import * as path from '@memon/file-protocol/paths'
import { padId, parseId } from '../ids.js'
import { projectFs as fs } from '../project-file-store.js'
import { EXPERIMENT_DIR_REGEX, EXPERIMENT_FILENAME_REGEX } from '../types.js'

const EXPERIMENTS_SUBDIR = 'docs/experiments'

/**
 * Scan `<projectRoot>/docs/experiments/` for existing experiments
 * (post-v5 folders OR legacy v4 files) and return `padId('E', max+1)`.
 * When the directory does not exist, returns `'E0001'`.
 *
 * Throws when the next id would exceed `E9999`.
 */
export async function nextExperimentId(projectRoot: string): Promise<string> {
  const dir = path.join(projectRoot, EXPERIMENTS_SUBDIR)
  let entries: string[]
  try {
    entries = await fs.readdir(dir)
  } catch (err) {
    const e = err as NodeJS.ErrnoException
    if (e.code === 'ENOENT') return padId('E', 1)
    throw err
  }
  let max = 0
  for (const entry of entries) {
    const m = entry.match(EXPERIMENT_DIR_REGEX) ?? entry.match(EXPERIMENT_FILENAME_REGEX)
    if (!m) continue
    const id = `E${m[1]}`
    const parsed = parseId(id)
    if (parsed && parsed.n > max) max = parsed.n
  }
  return padId('E', max + 1)
}

/**
 * Resolve a slug-or-id to a full canonical id by scanning existing
 * entries (post-v5 folders OR legacy v4 files). Returns null when no
 * match. Used by CLI commands that accept `<id-or-slug>`.
 */
export async function resolveExperimentId(
  projectRoot: string,
  needle: string,
): Promise<string | null> {
  const dir = path.join(projectRoot, EXPERIMENTS_SUBDIR)
  let entries: string[]
  try {
    entries = await fs.readdir(dir)
  } catch (err) {
    const e = err as NodeJS.ErrnoException
    if (e.code === 'ENOENT') return null
    throw err
  }
  // Direct id match: needle starts with E\d{4}-
  if (/^E\d{4}-/.test(needle)) {
    if (entries.includes(needle) || entries.includes(`${needle}.md`)) return needle
    return null
  }
  // Slug lookup: needle could be the slug part alone
  const matches: string[] = []
  for (const entry of entries) {
    const m = entry.match(EXPERIMENT_DIR_REGEX) ?? entry.match(EXPERIMENT_FILENAME_REGEX)
    if (!m) continue
    const slug = m[2]
    if (slug === needle) matches.push(`E${m[1]}-${slug}`)
  }
  if (matches.length === 1) return matches[0] ?? null
  return null
}
