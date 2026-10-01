import { dirname, join } from 'node:path'
import { padId, parseId, RUN_TIMESTAMP_TAIL_REGEX, SLUG_REGEX } from '../ids.js'
import { appendJournalEvent } from '../journal/append.js'
import { projectFs as fs } from '../project-file-store.js'
import { formatIsoLocal, parseSlugFromRunDir } from '../time.js'
import { discoverExperiments, readExperimentDoc } from './discover.js'
import { resolveExperimentId } from './id.js'
import { serializeExperimentReadme } from './serialize.js'

const SLUG_RE = SLUG_REGEX
const TIMESTAMP_TAIL_RE = RUN_TIMESTAMP_TAIL_REGEX

export interface RenameExperimentWarning {
  code: 'RUN_SLUG_PREFIX_VIOLATION'
  runId?: string
  message: string
}

export interface RenameExperimentResult {
  ok: true
  oldId: string
  newId: string
  noop?: boolean
  warnings: RenameExperimentWarning[]
}

export class RenameExperimentError extends Error {
  constructor(
    public code: 'BAD_REQUEST' | 'NOT_FOUND' | 'EXPERIMENT_SLUG_PREFIX_COLLISION' | 'BAD_STATE',
    message: string,
    public extra?: Record<string, unknown>,
  ) {
    super(message)
    this.name = 'RenameExperimentError'
  }
}

export interface RenameExperimentOptions {
  /** Now-iso clock injection for deterministic tests. */
  now?: () => string
}

export async function renameExperiment(
  projectRoot: string,
  projectName: string,
  oldIdOrSlug: string,
  newSlug: string,
  options: RenameExperimentOptions = {},
): Promise<RenameExperimentResult> {
  const now = options.now ?? (() => formatIsoLocal(new Date()))

  if (!SLUG_RE.test(newSlug)) {
    throw new RenameExperimentError('BAD_REQUEST', `new slug "${newSlug}" must match ${SLUG_RE}`)
  }
  if (TIMESTAMP_TAIL_RE.test(newSlug)) {
    throw new RenameExperimentError(
      'BAD_REQUEST',
      `new slug "${newSlug}" must NOT include a timestamp tail; provide the slug only`,
    )
  }

  const oldId = await resolveExperimentId(projectRoot, oldIdOrSlug)
  if (!oldId) {
    throw new RenameExperimentError(
      'NOT_FOUND',
      `no experiment matches "${oldIdOrSlug}" in ${projectRoot}`,
    )
  }
  const exp = await readExperimentDoc(projectRoot, projectName, oldId)
  if (!exp) {
    throw new RenameExperimentError(
      'NOT_FOUND',
      `experiment "${oldId}" resolved but record missing on disk in ${projectRoot}`,
    )
  }

  const oldSlug = exp.frontMatter.slug
  // Extract NNNN from oldId — already validated by resolveExperimentId.
  const numericPart = oldId.slice(1, 5) // strip leading 'E', take 4 digits
  const parsedOld = parseId(`E${numericPart}`)
  if (!parsedOld) {
    throw new RenameExperimentError(
      'BAD_STATE',
      `oldId "${oldId}" has unparseable NNNN — should not happen`,
    )
  }
  const newId = `${padId('E', parsedOld.n)}-${newSlug}`

  if (newSlug === oldSlug) {
    return { ok: true, oldId, newId: oldId, noop: true, warnings: [] }
  }

  // Slug-uniqueness preflight: scan every OTHER experiment.
  const { experiments } = await discoverExperiments(projectRoot, projectName)
  for (const other of experiments) {
    if (other.id === oldId) continue
    const otherSlug = other.frontMatter.slug
    if (!otherSlug) continue
    if (otherSlug === newSlug) {
      throw new RenameExperimentError(
        'EXPERIMENT_SLUG_PREFIX_COLLISION',
        `slug "${newSlug}" is already used by experiment ${other.id}`,
        { conflictingId: other.id },
      )
    }
    if (newSlug.startsWith(`${otherSlug}-`) || otherSlug.startsWith(`${newSlug}-`)) {
      throw new RenameExperimentError(
        'EXPERIMENT_SLUG_PREFIX_COLLISION',
        `slug "${newSlug}" prefix-collides with experiment ${other.id} (slug "${otherSlug}")`,
        { conflictingId: other.id },
      )
    }
  }

  // ── Step 1: folder / file rename ─────────────────────────────────
  const isLegacyFile = exp.path.endsWith(`${oldId}.md`)
  let newReadmePath: string
  if (isLegacyFile) {
    // Legacy v4 file form (mid-migration window).
    const newFilePath = join(dirname(exp.path), `${newId}.md`)
    await fs.rename(exp.path, newFilePath)
    newReadmePath = newFilePath
  } else {
    const oldFolder = dirname(exp.path)
    const newFolder = join(dirname(oldFolder), newId)
    await fs.rename(oldFolder, newFolder)
    newReadmePath = join(newFolder, 'README.md')
  }

  // ── Step 2: exp README frontmatter rewrite ───────────────────────
  {
    const content = await fs.readFile(newReadmePath, 'utf8')
    const filenameStem = isLegacyFile ? newId : newId
    const { parseExperimentReadme } = await import('./parse.js')
    const parsed = parseExperimentReadme(content, filenameStem)
    parsed.frontMatter.id = newId
    parsed.frontMatter.slug = newSlug
    parsed.frontMatter.updatedAt = now()
    const serialized = serializeExperimentReadme({
      frontMatter: parsed.frontMatter,
      sections: parsed.sections,
      warningsRaw: parsed.warningsRaw,
      rawSections: parsed.rawSections,
      rawBody: parsed.body,
    })
    await atomicWrite(newReadmePath, serialized)
  }

  const warnings: RenameExperimentWarning[] = []
  if (exp.frontMatter.runs.length > 0) {
    for (const runId of new Set(exp.frontMatter.runs)) {
      // Soft prefix-violation: warn when the run slug no longer starts
      // with the new exp slug.
      const runSlug = parseSlugFromRunDir(runId.split('/').at(-1)!)
      if (runSlug && !runSlug.startsWith(newSlug)) {
        warnings.push({
          code: 'RUN_SLUG_PREFIX_VIOLATION',
          runId,
          message: `run slug "${runSlug}" does not start with experiment slug "${newSlug}"`,
        })
      }
    }
  }

  // ── Step 4: hypotheses substitution ──────────────────────────────
  await substituteHypothesesId(projectRoot, oldId, newId)

  // ── Step 5: JOURNAL append ───────────────────────────────────────
  await appendJournalEvent({
    path: join(projectRoot, 'docs', 'journal.md'),
    event: {
      timestamp: now(),
      tag: 'RENAME',
      body: `op=experiment-rename old=${oldId} new=${newId}`,
    },
  })

  return { ok: true, oldId, newId, warnings }
}

async function substituteHypothesesId(
  projectRoot: string,
  oldId: string,
  newId: string,
): Promise<void> {
  const hypothesesPath = join(projectRoot, 'docs', 'hypotheses.md')
  let content: string
  try {
    content = await fs.readFile(hypothesesPath, 'utf8')
  } catch (err) {
    const e = err as NodeJS.ErrnoException
    if (e.code === 'ENOENT') return
    throw err
  }
  // Word-boundary aware: forbid alphanumeric or `-` on either side so
  // `E0001-foo` cannot match a substring of e.g. `E0001-foo-bar`.
  const escaped = oldId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const re = new RegExp(`(?<![A-Za-z0-9-])${escaped}(?![A-Za-z0-9-])`, 'g')
  const next = content.replace(re, newId)
  if (next === content) return
  await atomicWrite(hypothesesPath, next)
}

async function atomicWrite(path: string, content: string): Promise<void> {
  const tmp = join(dirname(path), `.${Date.now()}-${Math.random().toString(36).slice(2)}.cli.tmp`)
  await fs.writeFile(tmp, content, 'utf8')
  await fs.rename(tmp, path)
}
