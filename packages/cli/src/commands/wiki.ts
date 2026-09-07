// `memon wiki` — the wiki command group over
// `<projectRoot>/docs/wiki/<kind>/W<NNNN>-<slug>{.md,/README.md}`.
//
// Every projection (summary, staleness, backlinks, diagnostics, review) comes
// from `@memon/core`'s wiki module — discover → parse → resolve sources → lint
// → project — so the CLI, the Backend, and the dashboard agree by construction
// instead of drifting through three re-implementations.
//
// Two deliberate boundaries:
//   - Component descriptors live ONLY in the central dashboard. `components`
//     and `lint --central` reach them over HTTP; nothing about a component is
//     compiled into the CLI artifact.
//   - git is invoked only through `execFile` with an argv array (never a shell
//     string), and only by `review` / `commit`.
//
// Exit codes: 0 ok, 1 `lint --strict` failure / generic, 2 BAD_REQUEST,
// 4 NOT_FOUND (incl. NOT_A_GIT_PROJECT), 9 CONFLICT / REVIEW_ORDER /
// MIXED_INDEX. Errors are one `{"error":{"code","message"}}` object on stderr.

import { execFile } from 'node:child_process'
import { type Dirent, promises as fs } from 'node:fs'
import { dirname, join, resolve as resolvePath } from 'node:path'
import { promisify } from 'node:util'

import {
  buildWikiProject,
  deriveWikiReview,
  discoverExperiments,
  discoverWikiPages,
  formatIsoLocal,
  isGitWorktree,
  listWikiCommits,
  padId,
  parseId,
  parseWikiFrontmatter,
  readWikiReviewMarks,
  removeWikiReviewMark,
  REPORT_FILENAME_REGEX,
  scanProjectRoot,
  serializeWikiPage,
  updateWikiFrontmatter,
  verifiedThroughMark,
  WIKI_DIR_RELPATH,
  WIKI_ID_REGEX,
  WIKI_KINDS,
  WIKI_RECOMMENDED_SECTIONS,
  WIKI_RESERVED_KINDS,
  WIKI_SLUG_REGEX,
  WIKI_STATUS_BY_KIND,
  WIKI_TIMESTAMP_REGEX,
  wikiContentHash,
  WikiReviewError,
  WikiReviewOrderError,
  wikiStringList,
  writeWikiReviewMark,
  type DiscoveredWikiPage,
  type Experiment,
  type Run,
  type WikiBacklink,
  type WikiCommit,
  type WikiDiagnostic,
  type WikiFrontmatter,
  type WikiKind,
  type WikiProjectProjection,
  type WikiReview,
  type WikiReviewMark,
  type WikiSummary,
} from '@memon/core'

import { resolveContext, singleProjectRoot } from '../lib/context.js'
import { emitErrorAndExit } from '../lib/emit-error.js'
import { EXIT } from '../lib/exit-codes.js'
import { emitJson } from '../lib/output.js'

const execFileAsync = promisify(execFile)

const REPORT_DIR_REGEX = /^R(\d{4})-([a-z0-9][a-z0-9-]*)$/
const REPORTS_SUBDIR = 'docs/reports'
/** Evidence tokens a migrated Report body can supply as `sources`. */
const EVIDENCE_TOKEN_REGEX =
  /\b(E\d{4}(?:-[a-z0-9][a-z0-9-]*)?(?:\/V\d{4})?|H\d{4}|[A-Za-z0-9_]+(?:-[A-Za-z0-9_]+)*-\d{6}-\d{6})\b/g
/** Markdown inline-link destinations, used by the `R<NNNN>` backlink scan. */
const MARKDOWN_LINK_REGEX = /\]\(\s*(<[^>]+>|[^)\s]+)/g
const MARKDOWN_SCAN_MAX_DEPTH = 8
const GIT_TIMEOUT_MS = 30_000
const GIT_MAX_BUFFER = 64 * 1024 * 1024
/** `git`'s empty tree, so a never-verified page diffs as wholly added. */
const EMPTY_TREE_SHA = '4b825dc642cb6eb9a060e54bf8d69288fbee4904'

export type WikiFormat = 'json' | 'human' | 'markdown'
export type ReviewStateFilter = 'VERIFIED' | 'CHANGED_SINCE_VERIFY' | 'UNVERIFIED'

/** Flags every `memon wiki` subcommand takes. */
export interface WikiCommonInput {
  projectRoot?: string
  cwd: string
  format?: string
}

// ---------- format / addressing ----------

function readFormat(input: WikiCommonInput, allowMarkdown = false): WikiFormat {
  const raw = input.format ?? 'json'
  if (raw === 'json' || raw === 'human') return raw
  if (raw === 'markdown' && allowMarkdown) return 'markdown'
  emitErrorAndExit(
    'BAD_REQUEST',
    `--format must be one of json, human${allowMarkdown ? ', markdown' : ''}; got "${raw}"`,
  )
}

// ---------- project load ----------

interface WikiContext {
  projectRoot: string
  projectName: string
  pages: DiscoveredWikiPage[]
  byPath: Map<string, DiscoveredWikiPage>
  projection: WikiProjectProjection
  experiments: Experiment[]
  runs: Run[]
  reports: DiscoveredReport[]
  /** null outside a git worktree. */
  reviews: Map<string, WikiReview> | null
  marks: WikiReviewMark[]
}

/**
 * One pass over the project: wiki pages, the artifacts their `sources` point
 * at, the Reports (for `migrate-report` / `WIKI_LINK_UNRESOLVED`), and the
 * derived review state when the root is a git worktree.
 */
async function loadWiki(input: WikiCommonInput): Promise<WikiContext> {
  const ctx = await resolveContext(input)
  const projectRoot = singleProjectRoot(ctx)
  const projectName = ctx.config.projects[0]!.name

  const [pages, experimentsResult, snapshot, reports, hypothesesMtime] = await Promise.all([
    discoverWikiPages(projectRoot),
    discoverExperiments(projectRoot, projectName),
    scanProjectRoot(projectRoot, { includeArchived: true, projectName }),
    discoverReports(projectRoot),
    fileMtime(join(projectRoot, 'docs', 'hypotheses.md')),
  ])

  const runs: Run[] = snapshot.experiments
  const marks = (await isGitWorktree(projectRoot))
    ? await readWikiReviewMarks(projectRoot)
    : []
  const reviews = await deriveWikiReview(
    projectRoot,
    pages.map((page) => page.path),
    marks,
  )

  const projection = buildWikiProject(pages, {
    experiments: experimentsResult.experiments,
    runs,
    hypothesesMtime,
    hypothesisIds: snapshot.hypotheses.entries.map((entry) => entry.id),
    reportIds: reports.map((report) => report.id),
    reviews,
  })

  return {
    projectRoot,
    projectName,
    pages,
    byPath: new Map(pages.map((page) => [page.path, page])),
    projection,
    experiments: experimentsResult.experiments,
    runs,
    reports,
    reviews,
    marks,
  }
}

async function fileMtime(path: string): Promise<number | null> {
  try {
    return (await fs.stat(path)).mtimeMs
  } catch {
    return null
  }
}

interface DiscoveredReport {
  id: string
  slug: string
  format: 'markdown' | 'bundle'
  /** Project-relative POSIX path of the `.md` / `README.md`. */
  path: string
  absolutePath: string
  /** Absolute bundle directory; null for the single-file form. */
  bundleDir: string | null
}

/** `docs/reports/R<NNNN>-<slug>.md` and `docs/reports/R<NNNN>-<slug>/README.md`. */
async function discoverReports(projectRoot: string): Promise<DiscoveredReport[]> {
  const dir = join(projectRoot, REPORTS_SUBDIR)
  let entries: Dirent[]
  try {
    entries = await fs.readdir(dir, { withFileTypes: true })
  } catch {
    return []
  }
  const out: DiscoveredReport[] = []
  for (const entry of entries) {
    if (entry.isDirectory()) {
      const match = REPORT_DIR_REGEX.exec(entry.name)
      if (!match) continue
      const readme = join(dir, entry.name, 'README.md')
      if (!(await exists(readme))) continue
      out.push({
        id: `R${match[1]}`,
        slug: match[2]!,
        format: 'bundle',
        path: `${REPORTS_SUBDIR}/${entry.name}/README.md`,
        absolutePath: readme,
        bundleDir: join(dir, entry.name),
      })
      continue
    }
    const match = REPORT_FILENAME_REGEX.exec(entry.name)
    if (!match) continue
    out.push({
      id: `R${match[1]}`,
      slug: match[2]!,
      format: 'markdown',
      path: `${REPORTS_SUBDIR}/${entry.name}`,
      absolutePath: join(dir, entry.name),
      bundleDir: null,
    })
  }
  return out.sort((left, right) => (left.id < right.id ? -1 : 1))
}

async function exists(path: string): Promise<boolean> {
  try {
    await fs.stat(path)
    return true
  } catch {
    return false
  }
}

/**
 * Resolve a `<page>` argument: slug (primary) or canonical `W<NNNN>` id. An
 * unpadded id is a usage error, an unknown page a NOT_FOUND.
 */
function resolvePage(ctx: WikiContext, ref: string): WikiSummary {
  if (/^[Ww]\d+$/.test(ref) && !WIKI_ID_REGEX.test(ref)) {
    emitErrorAndExit(
      'BAD_REQUEST',
      `"${ref}" is not a canonical wiki id; ids are zero-padded to four digits (${padId('W', Number(ref.slice(1)) || 1)})`,
    )
  }
  const found = WIKI_ID_REGEX.test(ref)
    ? ctx.projection.byId.get(ref)
    : ctx.projection.bySlug.get(ref)
  if (!found) emitErrorAndExit('NOT_FOUND', `wiki page "${ref}" not found in ${ctx.projectRoot}`)
  return found
}

function discovered(ctx: WikiContext, summary: WikiSummary): DiscoveredWikiPage {
  const page = ctx.byPath.get(summary.path)
  if (!page) emitErrorAndExit('NOT_FOUND', `wiki page file "${summary.path}" disappeared`)
  return page
}

function assertKind(kind: string): WikiKind {
  if ((WIKI_RESERVED_KINDS as readonly string[]).includes(kind)) {
    emitErrorAndExit(
      'BAD_REQUEST',
      `"${kind}" is a reserved kind: code reviews are authored by \`memon-write-code-review\` until they are consolidated into the wiki`,
    )
  }
  if (!(WIKI_KINDS as readonly string[]).includes(kind)) {
    emitErrorAndExit(
      'BAD_REQUEST',
      `unknown wiki kind "${kind}"; expected one of ${WIKI_KINDS.join(', ')}`,
    )
  }
  return kind as WikiKind
}

/** Validate `status` against a kind's vocabulary; default to its first value. */
function resolveStatus(kind: WikiKind, status: string | undefined): string | undefined {
  const vocabulary = WIKI_STATUS_BY_KIND[kind]
  if (vocabulary.length === 0) {
    if (status !== undefined) {
      emitErrorAndExit('BAD_REQUEST', `\`${kind}\` pages carry no status; drop --status`)
    }
    return undefined
  }
  if (status === undefined) return vocabulary[0]
  if (!vocabulary.includes(status)) {
    emitErrorAndExit(
      'BAD_REQUEST',
      `status "${status}" is not valid for \`${kind}\`; expected one of ${vocabulary.join(', ')}`,
    )
  }
  return status
}

function assertSlug(slug: string): string {
  if (!WIKI_SLUG_REGEX.test(slug)) {
    emitErrorAndExit('BAD_REQUEST', `slug "${slug}" must match ${WIKI_SLUG_REGEX.source}`)
  }
  return slug
}

function assertSlugFree(ctx: WikiContext, slug: string, allowId?: string): void {
  const taken = ctx.projection.bySlug.get(slug)
  if (taken && taken.id !== allowId) {
    emitErrorAndExit(
      'CONFLICT',
      `slug "${slug}" is already used by ${taken.id} at ${taken.path}`,
      { id: taken.id, path: taken.path },
    )
  }
}

/** `padId('W', max + 1)` across file-name and frontmatter ids. */
function nextWikiId(ctx: WikiContext): string {
  let max = 0
  const consider = (value: string | undefined): void => {
    const parsed = value ? parseId(value) : null
    if (parsed && parsed.prefix === 'W' && parsed.n > max) max = parsed.n
  }
  for (const page of ctx.pages) {
    consider(page.id)
    const { frontmatter } = parseWikiFrontmatter(page.content)
    consider(typeof frontmatter?.id === 'string' ? frontmatter.id : undefined)
  }
  if (max >= 9999) emitErrorAndExit('CONFLICT', 'wiki id space exhausted (W9999 allocated)')
  return padId('W', max + 1)
}

/** Temp-file + rename, so a reader never observes a half-written page. */
async function atomicWrite(path: string, content: string): Promise<void> {
  const tmp = join(
    dirname(path),
    `.${Date.now()}-${Math.random().toString(36).slice(2)}.wiki.tmp`,
  )
  await fs.writeFile(tmp, content, 'utf8')
  await fs.rename(tmp, path)
}

/** The list projection `ls` prints: the summary minus its `mtime`. */
function listEntry(summary: WikiSummary): Omit<WikiSummary, 'mtime'> {
  const { mtime: _mtime, ...rest } = summary
  return rest
}

// ---------- memon wiki ls ----------

export interface WikiLsInput extends WikiCommonInput {
  kind?: string
  status?: string
  tag?: string
  stale?: boolean
  review?: string
  source?: string
  deprecated?: boolean
  description?: boolean
}

export async function runWikiLs(input: WikiLsInput): Promise<void> {
  const format = readFormat(input, true)
  const reviewFilter = input.review === undefined ? undefined : assertReviewState(input.review)
  const ctx = await loadWiki(input)

  const sourceMatches =
    input.source === undefined
      ? null
      : new Set((ctx.projection.backlinks.get(input.source) ?? []).map((row) => row.id))

  const pages = ctx.projection.summaries.filter((summary) => {
    if (input.kind !== undefined && summary.kind !== input.kind) return false
    if (input.status !== undefined && summary.status !== input.status) return false
    if (input.tag !== undefined && !summary.tags.includes(input.tag)) return false
    if (input.stale === true && !summary.stale) return false
    if (reviewFilter !== undefined && summary.review?.state !== reviewFilter) return false
    if (input.deprecated === true && summary.deprecated === null) return false
    if (input.deprecated === false && summary.deprecated !== null) return false
    if (sourceMatches && !sourceMatches.has(summary.id)) return false
    return true
  })

  const showDescription = input.description !== false

  if (format === 'json') {
    emitJson({ pages: pages.map(listEntry) })
    return
  }
  if (format === 'markdown') {
    process.stdout.write(renderLsMarkdown(pages, showDescription))
    return
  }
  if (pages.length === 0) {
    process.stdout.write('(no wiki pages)\n')
    return
  }
  const lines: string[] = []
  for (const page of pages) {
    const badges = [
      page.status ? `[${page.status}]` : null,
      page.review ? `[${page.review.state}]` : null,
      page.stale ? '[stale]' : null,
      page.deprecated ? '[deprecated]' : null,
    ].filter((badge): badge is string => badge !== null)
    lines.push(`${page.id}  ${page.path}  ${badges.join(' ')}  ${page.title}`.replace(/\s+$/, ''))
    if (showDescription && page.description) lines.push(`    ${page.description}`)
    if (page.deprecatedSections.length > 0) {
      lines.push(`    deprecated sections: ${page.deprecatedSections.join(', ')}`)
    }
  }
  process.stdout.write(`${lines.join('\n')}\n`)
}

function renderLsMarkdown(pages: readonly WikiSummary[], showDescription: boolean): string {
  if (pages.length === 0) return '(no wiki pages)\n'
  const out: string[] = []
  let currentKind: string | null = null
  for (const page of pages) {
    if (page.kind !== currentKind) {
      if (currentKind !== null) out.push('')
      currentKind = page.kind
      out.push(`## ${page.kind}`, '')
      out.push('| id | path | status | review | stale | updated_at | title | description |')
      out.push('| --- | --- | --- | --- | --- | --- | --- | --- |')
    }
    const cells = [
      page.id,
      `\`${page.path}\``,
      page.status ?? '—',
      page.review?.state ?? '—',
      page.stale ? 'yes' : 'no',
      page.updatedAt,
      page.deprecated ? `${page.title} [deprecated]` : page.title,
      showDescription ? (page.description ?? '') : '',
    ]
    out.push(`| ${cells.map((cell) => cell.replace(/\|/g, '\\|').replace(/\n+/g, ' ')).join(' | ')} |`)
  }
  return `${out.join('\n')}\n`
}

function assertReviewState(value: string): ReviewStateFilter {
  if (value === 'VERIFIED' || value === 'CHANGED_SINCE_VERIFY' || value === 'UNVERIFIED') {
    return value
  }
  emitErrorAndExit(
    'BAD_REQUEST',
    `--review must be one of VERIFIED, CHANGED_SINCE_VERIFY, UNVERIFIED; got "${value}"`,
  )
}

// ---------- memon wiki show ----------

export interface WikiShowInput extends WikiCommonInput {
  page: string
  bodyOnly?: boolean
}

export async function runWikiShow(input: WikiShowInput): Promise<void> {
  const format = readFormat(input, true)
  const ctx = await loadWiki(input)
  const summary = resolvePage(ctx, input.page)
  const page = discovered(ctx, summary)
  const { body } = parseWikiFrontmatter(page.content)
  const content = input.bodyOnly === true ? body : page.content

  if (format === 'json') {
    emitJson({ ...summary, content, hash: wikiContentHash(page.content) })
    return
  }
  if (input.bodyOnly === true) {
    process.stdout.write(body.endsWith('\n') ? body : `${body}\n`)
    return
  }
  if (format === 'markdown') {
    process.stdout.write(content.endsWith('\n') ? content : `${content}\n`)
    return
  }
  process.stdout.write(
    `${renderShowHeader(summary)}\n${content}${content.endsWith('\n') ? '' : '\n'}`,
  )
}

function renderShowHeader(summary: WikiSummary): string {
  const lines = [
    `${summary.id}  ${summary.kind}  ${summary.path}`,
    `title: ${summary.title}`,
    `description: ${summary.description ?? '—'}`,
    `status: ${summary.status ?? '—'}  date: ${summary.date ?? '—'}  updated_at: ${summary.updatedAt}`,
    `tags: ${summary.tags.join(', ') || '—'}  sources: ${summary.sources.join(', ') || '—'}`,
    `stale: ${summary.stale}${summary.stale ? ` (${summary.staleSources.join(', ')})` : ''}`,
    `review: ${
      summary.review
        ? `${summary.review.state} (verifiedThrough: ${summary.review.verifiedThrough ?? 'none'}, dirty: ${summary.review.dirty})`
        : '— (not a git worktree)'
    }`,
  ]
  if (summary.deprecated) {
    lines.push(
      `deprecated: ${summary.deprecated.at} — ${summary.deprecated.reason}${
        summary.deprecated.superseded_by ? ` (superseded by ${summary.deprecated.superseded_by})` : ''
      }`,
    )
  }
  if (summary.deprecatedSections.length > 0) {
    lines.push(`deprecated sections: ${summary.deprecatedSections.join(', ')}`)
  }
  lines.push(
    summary.diagnostics.length === 0
      ? 'diagnostics: none'
      : `diagnostics:\n${summary.diagnostics.map(formatDiagnostic).join('\n')}`,
  )
  return `${lines.join('\n')}\n`
}

function formatDiagnostic(diagnostic: WikiDiagnostic): string {
  const at = diagnostic.line === undefined ? '' : `:${diagnostic.line}`
  return `  [${diagnostic.severity}] ${diagnostic.code}${at} ${diagnostic.message}`
}

// ---------- memon wiki create ----------

export interface WikiCreateInput extends WikiCommonInput {
  kind: string
  slug: string
  title?: string
  description?: string
  status?: string
  date?: string
  source?: string[]
  tag?: string[]
  bundle?: boolean
}

export async function runWikiCreate(input: WikiCreateInput): Promise<void> {
  const format = readFormat(input)
  const kind = assertKind(input.kind)
  const slug = assertSlug(input.slug)
  if (input.title === undefined || input.title.trim() === '') {
    emitErrorAndExit('BAD_REQUEST', '--title is required and must be a non-empty string')
  }
  const status = resolveStatus(kind, input.status)
  if (kind === 'meeting' && (input.date === undefined || input.date.trim() === '')) {
    emitErrorAndExit('BAD_REQUEST', '`meeting` pages require --date <YYYY-MM-DD>')
  }
  if (input.date !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(input.date)) {
    emitErrorAndExit('BAD_REQUEST', `--date must be YYYY-MM-DD; got "${input.date}"`)
  }

  const ctx = await loadWiki(input)
  assertSlugFree(ctx, slug)
  const id = nextWikiId(ctx)
  const now = formatIsoLocal(new Date())

  const frontmatter: WikiFrontmatter = {
    id,
    kind,
    title: input.title.trim(),
    ...(input.description === undefined ? {} : { description: input.description }),
    ...(status === undefined ? {} : { status }),
    ...(input.date === undefined ? {} : { date: input.date }),
    ...(input.source && input.source.length > 0 ? { sources: input.source } : {}),
    ...(input.tag && input.tag.length > 0 ? { tags: input.tag } : {}),
    created_at: now,
    updated_at: now,
  }

  const sections = WIKI_RECOMMENDED_SECTIONS[kind]
  const body = [
    '',
    `# ${frontmatter.title}`,
    '',
    ...sections.flatMap((section) => [`## ${section}`, '']),
  ].join('\n')

  const kindDir = join(ctx.projectRoot, WIKI_DIR_RELPATH, kind)
  const name = `${id}-${slug}`
  const relative =
    input.bundle === true
      ? `${WIKI_DIR_RELPATH}/${kind}/${name}/README.md`
      : `${WIKI_DIR_RELPATH}/${kind}/${name}.md`
  const absolute = join(ctx.projectRoot, relative)
  await fs.mkdir(input.bundle === true ? join(kindDir, name) : kindDir, { recursive: true })
  try {
    await fs.writeFile(absolute, serializeWikiPage(frontmatter, body), { encoding: 'utf8', flag: 'wx' })
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'EEXIST') {
      emitErrorAndExit('CONFLICT', `${relative} already exists`)
    }
    throw err
  }

  await emitPageResult(input, format, relative, { absolutePath: absolute })
}

/**
 * Re-read the project so the printed summary carries the same staleness,
 * lint, and review facts every other surface would compute for the page.
 */
async function emitPageResult(
  input: WikiCommonInput,
  format: WikiFormat,
  path: string,
  extra: Record<string, unknown> = {},
): Promise<void> {
  const ctx = await loadWiki(input)
  const summary = ctx.projection.summaries.find((entry) => entry.path === path)
  if (!summary) emitErrorAndExit('NOT_FOUND', `wiki page at ${path} could not be re-read`)
  if (format === 'json') {
    emitJson({ ...summary, ...extra })
    return
  }
  process.stdout.write(renderShowHeader(summary))
  for (const [key, value] of Object.entries(extra)) {
    process.stdout.write(`${key}: ${String(value)}\n`)
  }
}

// ---------- memon wiki move ----------

export interface WikiMoveInput extends WikiCommonInput {
  page: string
  target: string
  status?: string
}

export async function runWikiMove(input: WikiMoveInput): Promise<void> {
  const format = readFormat(input)
  const [rawKind, rawSlug, ...rest] = input.target.split('/')
  if (rest.length > 0 || rawKind === undefined || rawKind === '') {
    emitErrorAndExit('BAD_REQUEST', `target must be "<kind>" or "<kind>/<slug>"; got "${input.target}"`)
  }
  const kind = assertKind(rawKind)

  const ctx = await loadWiki(input)
  const summary = resolvePage(ctx, input.page)
  const page = discovered(ctx, summary)
  const slug = rawSlug === undefined ? summary.slug : assertSlug(rawSlug)
  assertSlugFree(ctx, slug, summary.id)

  const vocabulary = WIKI_STATUS_BY_KIND[kind]
  let status: string | undefined
  if (input.status !== undefined) {
    status = resolveStatus(kind, input.status)
  } else if (vocabulary.length === 0) {
    // The new kind carries no status; the write below drops the old key
    // rather than leaving an ignored one behind.
    status = undefined
  } else if (summary.status === null || !vocabulary.includes(summary.status)) {
    emitErrorAndExit(
      'BAD_REQUEST',
      `status ${JSON.stringify(summary.status)} is not valid for \`${kind}\`; pass --status <${vocabulary.join('|')}>`,
    )
  } else {
    status = summary.status
  }

  const name = `${summary.id}-${slug}`
  const newRelative =
    summary.format === 'bundle'
      ? `${WIKI_DIR_RELPATH}/${kind}/${name}/README.md`
      : `${WIKI_DIR_RELPATH}/${kind}/${name}.md`
  if (newRelative === summary.path) {
    emitErrorAndExit('BAD_REQUEST', `page ${summary.id} is already at ${summary.path}`)
  }

  const oldRoot = summary.format === 'bundle' ? page.bundleDir! : page.absolutePath
  const newRoot =
    summary.format === 'bundle'
      ? join(ctx.projectRoot, WIKI_DIR_RELPATH, kind, name)
      : join(ctx.projectRoot, newRelative)
  await fs.mkdir(join(ctx.projectRoot, WIKI_DIR_RELPATH, kind), { recursive: true })
  if (await exists(newRoot)) {
    emitErrorAndExit('CONFLICT', `${newRelative} already exists`)
  }
  await fs.rename(oldRoot, newRoot)

  const readme = join(ctx.projectRoot, newRelative)
  const raw = await fs.readFile(readme, 'utf8')
  const parsed = parseWikiFrontmatter(raw)
  if (parsed.frontmatter) {
    const patch: Record<string, unknown> = { kind, updated_at: formatIsoLocal(new Date()) }
    if (vocabulary.length === 0) patch.status = undefined
    else if (status !== undefined) patch.status = status
    await atomicWrite(readme, serializeWikiPage(updateWikiFrontmatter(parsed.frontmatter, patch), parsed.body))
  }

  await emitPageResult(input, format, newRelative, { oldPath: summary.path, newPath: newRelative })
}

// ---------- memon wiki set ----------

export interface WikiSetInput extends WikiCommonInput {
  page: string
  status?: string
  title?: string
  description?: string
  date?: string
  addSource?: string[]
  rmSource?: string[]
  addTag?: string[]
  rmTag?: string[]
  expectedMtime?: number
}

export async function runWikiSet(input: WikiSetInput): Promise<void> {
  const format = readFormat(input)
  const changes = [
    input.status,
    input.title,
    input.description,
    input.date,
    input.addSource?.length ? 'x' : undefined,
    input.rmSource?.length ? 'x' : undefined,
    input.addTag?.length ? 'x' : undefined,
    input.rmTag?.length ? 'x' : undefined,
  ].filter((value) => value !== undefined)
  if (changes.length === 0) {
    emitErrorAndExit(
      'BAD_REQUEST',
      'at least one change flag is required: --status --title --description --date --add-source --rm-source --add-tag --rm-tag',
    )
  }
  if (input.date !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(input.date)) {
    emitErrorAndExit('BAD_REQUEST', `--date must be YYYY-MM-DD; got "${input.date}"`)
  }

  const ctx = await loadWiki(input)
  const summary = resolvePage(ctx, input.page)
  const page = discovered(ctx, summary)

  if (input.status !== undefined) {
    if ((WIKI_KINDS as readonly string[]).includes(summary.kind)) {
      resolveStatus(summary.kind as WikiKind, input.status)
    }
  }
  assertMtime(page, input.expectedMtime)

  const parsed = parseWikiFrontmatter(page.content)
  if (!parsed.frontmatter) {
    emitErrorAndExit('BAD_REQUEST', `${summary.path} has no readable YAML frontmatter; fix it by hand first`)
  }

  const patch: Record<string, unknown> = { updated_at: formatIsoLocal(new Date()) }
  if (input.status !== undefined) patch.status = input.status
  if (input.title !== undefined) patch.title = input.title
  if (input.description !== undefined) patch.description = input.description
  if (input.date !== undefined) patch.date = input.date
  const sources = applyListEdit(summary.sources, input.addSource, input.rmSource)
  if (sources) patch.sources = sources
  const tags = applyListEdit(summary.tags, input.addTag, input.rmTag)
  if (tags) patch.tags = tags

  await atomicWrite(
    page.absolutePath,
    serializeWikiPage(updateWikiFrontmatter(parsed.frontmatter, patch), parsed.body),
  )
  await emitPageResult(input, format, summary.path)
}

function applyListEdit(
  current: readonly string[],
  add: readonly string[] | undefined,
  remove: readonly string[] | undefined,
): string[] | null {
  if ((!add || add.length === 0) && (!remove || remove.length === 0)) return null
  const removals = new Set(remove ?? [])
  const next = current.filter((entry) => !removals.has(entry))
  for (const entry of add ?? []) if (!next.includes(entry)) next.push(entry)
  return next
}

function assertMtime(page: DiscoveredWikiPage, expected: number | undefined): void {
  if (expected === undefined) return
  if (Math.trunc(page.mtime) !== Math.trunc(expected)) {
    emitErrorAndExit(
      'CONFLICT',
      `${page.path} changed on disk: expected mtime ${expected}, found ${Math.trunc(page.mtime)}`,
      { currentMtime: page.mtime, currentHash: wikiContentHash(page.content) },
    )
  }
}

// ---------- memon wiki deprecate / undeprecate ----------

export interface WikiDeprecateInput extends WikiCommonInput {
  page: string
  reason?: string
  supersededBy?: string
  at?: string
}

export async function runWikiDeprecate(input: WikiDeprecateInput): Promise<void> {
  const format = readFormat(input)
  if (input.reason === undefined || input.reason.trim() === '') {
    emitErrorAndExit('BAD_REQUEST', '--reason is required')
  }
  if (input.at !== undefined && !WIKI_TIMESTAMP_REGEX.test(input.at)) {
    emitErrorAndExit('BAD_REQUEST', `--at must be ISO8601 with an explicit offset; got "${input.at}"`)
  }
  const ctx = await loadWiki(input)
  const summary = resolvePage(ctx, input.page)
  const page = discovered(ctx, summary)
  if (input.supersededBy !== undefined) {
    if (!WIKI_ID_REGEX.test(input.supersededBy)) {
      emitErrorAndExit('BAD_REQUEST', `--superseded-by must be a canonical W<NNNN> id; got "${input.supersededBy}"`)
    }
    if (!ctx.projection.byId.has(input.supersededBy)) {
      emitErrorAndExit('NOT_FOUND', `--superseded-by ${input.supersededBy} is not a wiki page in this project`)
    }
  }

  const parsed = parseWikiFrontmatter(page.content)
  if (!parsed.frontmatter) {
    emitErrorAndExit('BAD_REQUEST', `${summary.path} has no readable YAML frontmatter; fix it by hand first`)
  }
  const now = formatIsoLocal(new Date())
  const deprecated: Record<string, unknown> = {
    at: input.at ?? now,
    reason: input.reason.trim(),
    ...(input.supersededBy === undefined ? {} : { superseded_by: input.supersededBy }),
  }
  await atomicWrite(
    page.absolutePath,
    serializeWikiPage(
      updateWikiFrontmatter(parsed.frontmatter, { deprecated, updated_at: now }),
      parsed.body,
    ),
  )
  await emitPageResult(input, format, summary.path)
}

export interface WikiUndeprecateInput extends WikiCommonInput {
  page: string
}

export async function runWikiUndeprecate(input: WikiUndeprecateInput): Promise<void> {
  const format = readFormat(input)
  const ctx = await loadWiki(input)
  const summary = resolvePage(ctx, input.page)
  const page = discovered(ctx, summary)
  const parsed = parseWikiFrontmatter(page.content)
  if (!parsed.frontmatter) {
    emitErrorAndExit('BAD_REQUEST', `${summary.path} has no readable YAML frontmatter; fix it by hand first`)
  }
  await atomicWrite(
    page.absolutePath,
    serializeWikiPage(
      updateWikiFrontmatter(parsed.frontmatter, {
        deprecated: undefined,
        updated_at: formatIsoLocal(new Date()),
      }),
      parsed.body,
    ),
  )
  await emitPageResult(input, format, summary.path)
}

// ---------- memon wiki delete ----------

export interface WikiDeleteInput extends WikiCommonInput {
  page: string
  force?: boolean
}

export async function runWikiDelete(input: WikiDeleteInput): Promise<void> {
  const format = readFormat(input)
  const ctx = await loadWiki(input)
  const summary = resolvePage(ctx, input.page)
  const page = discovered(ctx, summary)

  const removed: string[] = []
  if (summary.format === 'bundle') {
    const extra = page.assets.filter((asset) => asset !== 'README.md')
    if (extra.length > 0 && input.force !== true) {
      emitErrorAndExit(
        'BAD_REQUEST',
        `bundle ${summary.id} holds ${extra.length} file(s) besides README.md; pass --force to delete them too`,
        { extra },
      )
    }
    const bundleRelative = summary.path.slice(0, -'/README.md'.length)
    await fs.rm(page.bundleDir!, { recursive: true, force: true })
    removed.push(bundleRelative)
  } else {
    await fs.rm(page.absolutePath, { force: true })
    removed.push(summary.path)
  }

  if (format === 'json') {
    emitJson({ id: summary.id, slug: summary.slug, kind: summary.kind, removed })
    return
  }
  process.stdout.write(`removed ${summary.id}: ${removed.join(', ')}\n`)
}

// ---------- memon wiki lint ----------

export interface WikiLintInput extends WikiCommonInput {
  page?: string
  strict?: boolean
  central?: string
}

export async function runWikiLint(input: WikiLintInput): Promise<void> {
  const format = readFormat(input)
  const ctx = await loadWiki(input)
  const targets =
    input.page === undefined ? ctx.projection.summaries : [resolvePage(ctx, input.page)]

  const rows = targets.map((summary) => ({
    id: summary.id,
    slug: summary.slug,
    kind: summary.kind,
    path: summary.path,
    diagnostics: [...summary.diagnostics],
  }))

  if (input.central !== undefined) {
    const central = resolveCentral(input.central)
    for (const row of rows) {
      const page = ctx.byPath.get(row.path)
      if (!page) continue
      const result = await centralRequest<{ diagnostics?: WikiDiagnostic[] }>(central, {
        path: '/api/wiki/components/lint',
        method: 'POST',
        body: { content: page.content },
      })
      row.diagnostics.push(...(result.diagnostics ?? []))
    }
  }

  const errors = rows.reduce(
    (total, row) => total + row.diagnostics.filter((d) => d.severity === 'error').length,
    0,
  )
  const warnings = rows.reduce(
    (total, row) => total + row.diagnostics.filter((d) => d.severity !== 'error').length,
    0,
  )

  if (format === 'json') {
    emitJson({
      pages: rows,
      summary: { pages: rows.length, errors, warnings, strict: input.strict === true },
    })
  } else {
    const lines: string[] = []
    for (const row of rows) {
      if (row.diagnostics.length === 0) continue
      lines.push(`${row.id}  ${row.path}`)
      for (const diagnostic of row.diagnostics) lines.push(formatDiagnostic(diagnostic))
    }
    lines.push(`${rows.length} page(s), ${errors} error(s), ${warnings} warning(s)`)
    process.stdout.write(`${lines.join('\n')}\n`)
  }

  if (input.strict === true && errors > 0) process.exitCode = EXIT.GENERIC
}

// ---------- memon wiki stale ----------

export async function runWikiStale(input: WikiCommonInput): Promise<void> {
  const format = readFormat(input)
  const ctx = await loadWiki(input)
  const pages = ctx.projection.summaries
    .filter((summary) => summary.stale)
    .map((summary) => ({
      id: summary.id,
      slug: summary.slug,
      kind: summary.kind,
      path: summary.path,
      title: summary.title,
      updatedAt: summary.updatedAt,
      staleSources: summary.staleSources,
    }))

  if (format === 'json') {
    emitJson({ pages })
    return
  }
  if (pages.length === 0) {
    process.stdout.write('(no stale pages)\n')
    return
  }
  process.stdout.write(
    `${pages
      .map((page) => `${page.id}  ${page.path}  ${page.staleSources.join(', ')}  ${page.title}`)
      .join('\n')}\n`,
  )
}

// ---------- memon wiki backlinks ----------

export interface WikiBacklinksInput extends WikiCommonInput {
  artifact: string
}

interface MarkdownReference {
  /** Project-relative POSIX path of the referencing file. */
  path: string
  /** Link destination as written. */
  target: string
  line: number
}

export async function runWikiBacklinks(input: WikiBacklinksInput): Promise<void> {
  const format = readFormat(input)
  const ctx = await loadWiki(input)
  const result = await collectBacklinks(ctx, input.artifact)

  if (format === 'json') {
    emitJson(result)
    return
  }
  const lines = [`artifact: ${result.artifact}`]
  if (result.pages.length === 0) lines.push('(no citing pages)')
  for (const row of result.pages) {
    const badges = [
      row.status ? `[${row.status}]` : null,
      row.reviewState ? `[${row.reviewState}]` : null,
      row.stale ? '[stale]' : null,
      row.deprecated ? '[deprecated]' : null,
    ].filter((badge): badge is string => badge !== null)
    lines.push(`${row.id}  ${row.kind}  ${badges.join(' ')}  ${row.title}`)
  }
  if (result.markdownReferences) {
    lines.push('markdownReferences:')
    if (result.markdownReferences.length === 0) lines.push('  (none)')
    for (const reference of result.markdownReferences) {
      lines.push(`  ${reference.path}:${reference.line}  ${reference.target}`)
    }
  }
  process.stdout.write(`${lines.join('\n')}\n`)
}

interface BacklinksResult {
  artifact: string
  pages: WikiBacklink[]
  markdownReferences?: MarkdownReference[]
}

async function collectBacklinks(ctx: WikiContext, artifact: string): Promise<BacklinksResult> {
  if (/^[Rr]\d+$/.test(artifact) && !/^R\d{4}$/.test(artifact)) {
    emitErrorAndExit('BAD_REQUEST', `"${artifact}" is not a canonical Report id (R<NNNN>)`)
  }
  const pages = [...(ctx.projection.backlinks.get(artifact) ?? [])]
  if (!/^R\d{4}$/.test(artifact)) return { artifact, pages }
  return {
    artifact,
    pages,
    markdownReferences: await scanReportReferences(ctx, artifact),
  }
}

/**
 * Every Markdown file under `docs/` and every run `README.md` carrying a
 * relative link that resolves to `docs/reports/<R-id>-…`. Existence of the
 * Report is irrelevant — the point is to find links a migration broke.
 */
async function scanReportReferences(
  ctx: WikiContext,
  reportId: string,
): Promise<MarkdownReference[]> {
  const candidates = new Set<string>()
  for (const file of await listMarkdownFiles(join(ctx.projectRoot, 'docs'))) candidates.add(file)
  for (const run of ctx.runs) candidates.add(join(run.path, 'README.md'))

  const targetRegex = new RegExp(`^docs/reports/${reportId}(?:-[^/]*)?(?:/.*|\\.md)?$`)
  const references: MarkdownReference[] = []
  for (const absolute of [...candidates].sort()) {
    let content: string
    try {
      content = await fs.readFile(absolute, 'utf8')
    } catch {
      continue
    }
    const fileDir = dirname(absolute)
    const lines = content.split('\n')
    for (const [index, line] of lines.entries()) {
      for (const match of line.matchAll(MARKDOWN_LINK_REGEX)) {
        const raw = match[1]!.replace(/^<|>$/g, '')
        const target = raw.split('#')[0]!.split('?')[0]!
        if (target === '' || /^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith('@')) continue
        const resolved = toProjectRelative(ctx.projectRoot, resolvePath(fileDir, target))
        if (!targetRegex.test(resolved)) continue
        references.push({
          path: toProjectRelative(ctx.projectRoot, absolute),
          target: raw,
          line: index + 1,
        })
      }
    }
  }
  return references
}

async function listMarkdownFiles(root: string, depth = 0): Promise<string[]> {
  if (depth > MARKDOWN_SCAN_MAX_DEPTH) return []
  let entries: Dirent[]
  try {
    entries = await fs.readdir(root, { withFileTypes: true })
  } catch {
    return []
  }
  const out: string[] = []
  for (const entry of entries) {
    if (entry.name.startsWith('.') || entry.name === 'node_modules') continue
    const absolute = join(root, entry.name)
    if (entry.isDirectory()) out.push(...(await listMarkdownFiles(absolute, depth + 1)))
    else if (entry.isFile() && entry.name.endsWith('.md')) out.push(absolute)
  }
  return out
}

function toProjectRelative(projectRoot: string, absolute: string): string {
  const relative = absolute.startsWith(projectRoot)
    ? absolute.slice(projectRoot.length).replace(/^[/\\]+/, '')
    : absolute
  return relative.split(/[/\\]/).join('/')
}

// ---------- memon wiki migrate-report ----------

export interface WikiMigrateReportInput extends WikiCommonInput {
  report: string
  kind: string
  slug?: string
  status?: string
}

export async function runWikiMigrateReport(input: WikiMigrateReportInput): Promise<void> {
  const format = readFormat(input)
  const kind = assertKind(input.kind)
  const status = resolveStatus(kind, input.status)
  if (/^[Rr]\d+$/.test(input.report) && !/^R\d{4}$/.test(input.report)) {
    emitErrorAndExit('BAD_REQUEST', `"${input.report}" is not a canonical Report id (R<NNNN>)`)
  }

  const ctx = await loadWiki(input)
  const report = ctx.reports.find((entry) => entry.id === input.report)
  if (!report) {
    emitErrorAndExit('NOT_FOUND', `report "${input.report}" not found under ${REPORTS_SUBDIR}/`)
  }
  const slug = assertSlug(input.slug ?? report.slug)
  assertSlugFree(ctx, slug)
  const id = nextWikiId(ctx)

  // Collected before the copy so the migrated page cannot show up as its own
  // referrer.
  const backlinks = await collectBacklinks(ctx, report.id)

  const name = `${id}-${slug}`
  const newRelative =
    report.format === 'bundle'
      ? `${WIKI_DIR_RELPATH}/${kind}/${name}/README.md`
      : `${WIKI_DIR_RELPATH}/${kind}/${name}.md`
  const newRoot =
    report.format === 'bundle'
      ? join(ctx.projectRoot, WIKI_DIR_RELPATH, kind, name)
      : join(ctx.projectRoot, newRelative)
  if (await exists(newRoot)) emitErrorAndExit('CONFLICT', `${newRelative} already exists`)
  await fs.mkdir(join(ctx.projectRoot, WIKI_DIR_RELPATH, kind), { recursive: true })

  let aborted = false
  const rollback = async (): Promise<void> => {
    await fs.rm(newRoot, { recursive: true, force: true })
  }

  try {
    if (report.format === 'bundle') {
      await fs.cp(report.bundleDir!, newRoot, { recursive: true })
    } else {
      await fs.cp(report.absolutePath, newRoot)
    }

    const readme = join(ctx.projectRoot, newRelative)
    const raw = await fs.readFile(readme, 'utf8')
    const parsed = parseWikiFrontmatter(raw)
    const existing: WikiFrontmatter = parsed.frontmatter ?? ({} as WikiFrontmatter)
    const mtime = (await fs.stat(readme)).mtimeMs
    const now = formatIsoLocal(new Date())
    const body = parsed.frontmatter ? parsed.body : raw

    const patch: Record<string, unknown> = {
      id,
      kind,
      legacy_id: report.id,
      updated_at: now,
      ...(status === undefined ? { status: undefined } : { status }),
    }
    if (typeof existing.title !== 'string' || existing.title.trim() === '') {
      patch.title = firstHeading(body) ?? slug
    }
    if (
      typeof existing.created_at !== 'string' ||
      !WIKI_TIMESTAMP_REGEX.test(existing.created_at)
    ) {
      patch.created_at = formatIsoLocal(new Date(mtime))
    }
    if (kind === 'meeting' && typeof existing.date !== 'string') {
      const created = typeof patch.created_at === 'string' ? patch.created_at : existing.created_at
      if (typeof created === 'string') patch.date = created.slice(0, 10)
    }
    // `finding` requires evidence and a Report carries no `sources`, so the
    // tokens its body cites are the only honest seed. The migrating agent
    // curates them right after (see the `memon-wiki` skill).
    if (kind === 'finding' && wikiStringList(existing.sources).length === 0) {
      const derived = deriveSources(body)
      if (derived.length > 0) patch.sources = derived
    }

    await atomicWrite(readme, serializeWikiPage(updateWikiFrontmatter(existing, patch), body))

    // Lint the page in its new home before the Report is destroyed.
    const after = await loadWiki(input)
    const summary = after.projection.summaries.find((entry) => entry.path === newRelative)
    const errors = (summary?.diagnostics ?? []).filter((d) => d.severity === 'error')
    if (!summary || errors.length > 0) {
      aborted = true
      await rollback()
      emitErrorAndExit(
        'LINT_ERROR',
        `migrated page would carry ${errors.length} lint error(s); ${report.path} left untouched`,
        { diagnostics: errors },
        EXIT.GENERIC,
      )
    }

    if (report.format === 'bundle') {
      await fs.rm(report.bundleDir!, { recursive: true, force: true })
    } else {
      await fs.rm(report.absolutePath, { force: true })
    }

    if (format === 'json') {
      emitJson({
        oldPath: report.path,
        newPath: newRelative,
        page: summary,
        backlinks,
      })
      return
    }
    process.stdout.write(
      `${report.id} ${report.path} -> ${summary.id} ${newRelative}\n${renderShowHeader(summary)}`,
    )
    if (backlinks.markdownReferences && backlinks.markdownReferences.length > 0) {
      process.stdout.write(
        `markdownReferences to fix:\n${backlinks.markdownReferences
          .map((reference) => `  ${reference.path}:${reference.line}  ${reference.target}`)
          .join('\n')}\n`,
      )
    }
  } catch (err) {
    if (!aborted) await rollback()
    throw err
  }
}

function firstHeading(body: string): string | null {
  for (const line of body.split('\n')) {
    const match = /^ {0,3}#\s+(.+?)\s*#*\s*$/.exec(line)
    if (match) return match[1]!.trim()
  }
  return null
}

function deriveSources(body: string): string[] {
  const out: string[] = []
  for (const match of body.matchAll(EVIDENCE_TOKEN_REGEX)) {
    const token = match[1]!
    if (!out.includes(token)) out.push(token)
  }
  return out
}

// ---------- git plumbing (review / commit) ----------

interface GitResult {
  ok: boolean
  stdout: string
  stderr: string
}

async function git(projectRoot: string, args: string[]): Promise<GitResult> {
  try {
    const { stdout, stderr } = await execFileAsync('git', args, {
      cwd: projectRoot,
      encoding: 'utf8',
      timeout: GIT_TIMEOUT_MS,
      maxBuffer: GIT_MAX_BUFFER,
    })
    return { ok: true, stdout, stderr }
  } catch (err) {
    const failure = err as { stdout?: string; stderr?: string; message?: string }
    return {
      ok: false,
      stdout: failure.stdout ?? '',
      stderr: failure.stderr ?? failure.message ?? '',
    }
  }
}

function requireGit(ctx: WikiContext): void {
  if (ctx.reviews === null) {
    emitErrorAndExit(
      'NOT_A_GIT_PROJECT',
      `${ctx.projectRoot} is not inside a git worktree; wiki review and commit need git`,
      undefined,
      EXIT.NOT_FOUND,
    )
  }
}

function reviewOf(ctx: WikiContext, summary: WikiSummary): WikiReview {
  const review = summary.review ?? ctx.reviews?.get(summary.path)
  if (!review) {
    emitErrorAndExit(
      'NOT_A_GIT_PROJECT',
      `no review state for ${summary.path}`,
      undefined,
      EXIT.NOT_FOUND,
    )
  }
  return review
}

// ---------- memon wiki review ----------

export async function runWikiReviewLog(input: WikiCommonInput): Promise<void> {
  const format = readFormat(input)
  const ctx = await loadWiki(input)
  requireGit(ctx)
  const commits = (await listWikiCommits(ctx.projectRoot)) ?? []
  const marksBySha = new Map(ctx.marks.map((mark) => [mark.sha, mark]))
  const verifiedThrough = verifiedThroughMark(commits, ctx.marks)?.sha ?? null

  const rows = commits.map((commit: WikiCommit) => {
    const mark = marksBySha.get(commit.sha)
    return {
      sha: commit.sha,
      authoredAt: commit.authoredAt,
      subject: commit.subject,
      pages: commit.pages,
      files: commit.files,
      verified: mark !== undefined,
      verifiedAt: mark?.verifiedAt ?? null,
      note: mark?.note ?? null,
    }
  })

  if (format === 'json') {
    emitJson({ verifiedThrough, commits: rows })
    return
  }
  if (rows.length === 0) {
    process.stdout.write('(no wiki commits)\n')
    return
  }
  const lines = rows.map(
    (row) =>
      `${row.verified ? '✓' : ' '} ${row.sha.slice(0, 10)}  ${row.authoredAt}  ${
        row.pages.join(',') || '—'
      }  ${row.subject}`,
  )
  lines.push(`verifiedThrough: ${verifiedThrough ?? 'none'}`)
  process.stdout.write(`${lines.join('\n')}\n`)
}

export interface WikiReviewLsInput extends WikiCommonInput {
  state?: string
}

export async function runWikiReviewLs(input: WikiReviewLsInput): Promise<void> {
  const format = readFormat(input)
  const stateFilter = input.state === undefined ? undefined : assertReviewState(input.state)
  const ctx = await loadWiki(input)
  requireGit(ctx)

  const rows = ctx.projection.summaries
    .map((summary) => {
      const review = reviewOf(ctx, summary)
      return {
        id: summary.id,
        slug: summary.slug,
        kind: summary.kind,
        path: summary.path,
        title: summary.title,
        state: review.state,
        verifiedThrough: review.verifiedThrough,
        unverifiedCommits: review.unverifiedCommits.length,
        unverifiedRanges: review.unverifiedRanges,
        dirty: review.dirty,
      }
    })
    .filter((row) => stateFilter === undefined || row.state === stateFilter)

  if (format === 'json') {
    emitJson({ pages: rows })
    return
  }
  if (rows.length === 0) {
    process.stdout.write('(no matching pages)\n')
    return
  }
  process.stdout.write(
    `${rows
      .map(
        (row) =>
          `${row.id}  ${row.state.padEnd(21)} ${String(row.unverifiedCommits).padStart(3)} commit(s)${
            row.dirty ? '  dirty' : ''
          }  ${row.path}`,
      )
      .join('\n')}\n`,
  )
}

export interface WikiReviewDiffInput extends WikiCommonInput {
  page: string
}

export async function runWikiReviewDiff(input: WikiReviewDiffInput): Promise<void> {
  const format = readFormat(input)
  const ctx = await loadWiki(input)
  requireGit(ctx)
  const summary = resolvePage(ctx, input.page)
  const review = reviewOf(ctx, summary)
  if (review.state === 'VERIFIED') return

  const page = discovered(ctx, summary)
  const pathspec = page.bundleDir === null ? summary.path : summary.path.slice(0, -'/README.md'.length)
  const from = review.verifiedThrough ?? EMPTY_TREE_SHA
  const result = await git(ctx.projectRoot, ['diff', from, '--', pathspec])
  if (!result.ok) {
    emitErrorAndExit('GIT_FAILED', `git diff failed: ${result.stderr.trim()}`, undefined, EXIT.GENERIC)
  }

  if (format === 'json') {
    emitJson({
      id: summary.id,
      path: summary.path,
      state: review.state,
      from: review.verifiedThrough,
      diff: result.stdout,
    })
    return
  }
  process.stdout.write(result.stdout)
}

export interface WikiReviewVerifyInput extends WikiCommonInput {
  sha: string
  note?: string
}

export async function runWikiReviewVerify(input: WikiReviewVerifyInput): Promise<void> {
  const format = readFormat(input)
  const ctx = await loadWiki(input)
  requireGit(ctx)

  let mark: WikiReviewMark
  try {
    mark = await writeWikiReviewMark(ctx.projectRoot, input.sha, input.note)
  } catch (err) {
    if (err instanceof WikiReviewOrderError) {
      emitErrorAndExit(
        'REVIEW_ORDER',
        err.message,
        { nextSha: err.nextSha },
        EXIT.CONFLICT,
      )
    }
    if (err instanceof WikiReviewError) {
      emitErrorAndExit(
        err.code === 'NOT_GIT' ? 'NOT_A_GIT_PROJECT' : 'NOT_FOUND',
        err.message,
        undefined,
        EXIT.NOT_FOUND,
      )
    }
    throw err
  }

  const commits = (await listWikiCommits(ctx.projectRoot)) ?? []
  const marks = await readWikiReviewMarks(ctx.projectRoot)
  const marked = new Set(marks.map((entry) => entry.sha))
  const next = commits.find((commit) => !marked.has(commit.sha)) ?? null

  const payload = {
    verified: { sha: mark.sha, verifiedAt: mark.verifiedAt, note: mark.note },
    verifiedThrough: verifiedThroughMark(commits, marks)?.sha ?? null,
    next: next === null ? null : { sha: next.sha, subject: next.subject, pages: next.pages },
  }
  if (format === 'json') {
    emitJson(payload)
    return
  }
  process.stdout.write(
    `verified ${mark.sha}\nnext: ${next === null ? 'nothing left to verify' : `${next.sha} ${next.subject}`}\n`,
  )
}

export interface WikiReviewUnverifyInput extends WikiCommonInput {
  sha: string
}

export async function runWikiReviewUnverify(input: WikiReviewUnverifyInput): Promise<void> {
  const format = readFormat(input)
  const ctx = await loadWiki(input)
  requireGit(ctx)
  const result = await removeWikiReviewMark(ctx.projectRoot, input.sha)
  if (result.removed.length === 0) {
    emitErrorAndExit('NOT_FOUND', `no review mark matches "${input.sha}"`)
  }
  if (format === 'json') {
    emitJson(result)
    return
  }
  process.stdout.write(
    `removed ${result.removed.length} mark(s): ${result.removed.join(', ')}\nverifiedThrough: ${
      result.verifiedThrough ?? 'none'
    }\n`,
  )
}

// ---------- memon wiki commit ----------

export interface WikiCommitInput extends WikiCommonInput {
  message?: string
  allowEmptyMessage?: boolean
}

export async function runWikiCommit(input: WikiCommitInput): Promise<void> {
  const format = readFormat(input)
  const ctx = await loadWiki(input)
  requireGit(ctx)

  const prefix = (await git(ctx.projectRoot, ['rev-parse', '--show-prefix'])).stdout.trim()
  const wikiPrefix = `${prefix}${WIKI_DIR_RELPATH}/`

  const alreadyStaged = (
    await git(ctx.projectRoot, ['diff', '--cached', '--name-only', '-z'])
  ).stdout
    .split('\0')
    .filter((entry) => entry !== '')
  const foreign = alreadyStaged.filter((path) => !path.startsWith(wikiPrefix))
  if (foreign.length > 0) {
    emitErrorAndExit(
      'MIXED_INDEX',
      `the index already holds ${foreign.length} non-wiki path(s); commit or reset them first`,
      { staged: foreign },
      EXIT.CONFLICT,
    )
  }

  if (await exists(join(ctx.projectRoot, WIKI_DIR_RELPATH))) {
    const staged = await git(ctx.projectRoot, ['add', '-A', '--', WIKI_DIR_RELPATH])
    if (!staged.ok) {
      emitErrorAndExit('GIT_FAILED', `git add failed: ${staged.stderr.trim()}`, undefined, EXIT.GENERIC)
    }
  }

  const statusRows = parseNameStatus(
    (await git(ctx.projectRoot, ['diff', '--cached', '--name-status', '-z'])).stdout,
  )
  if (statusRows.length === 0) {
    emitErrorAndExit('BAD_REQUEST', `nothing to commit under ${WIKI_DIR_RELPATH}/`)
  }

  const changes = new Map<string, { change: string; paths: string[] }>()
  const files: string[] = []
  for (const row of statusRows) {
    const relative = row.path.startsWith(prefix) ? row.path.slice(prefix.length) : row.path
    files.push(relative)
    const id = /(?:^|\/)(W\d{4})(?:[-./]|$)/.exec(relative)?.[1]
    if (!id) continue
    const entry = changes.get(id) ?? { change: row.status, paths: [] }
    entry.paths.push(relative)
    entry.change = mergeChange(entry.change, row.status)
    changes.set(id, entry)
  }

  const pageIds = [...changes.keys()].sort()
  const generated =
    pageIds.length > 0
      ? pageIds.map((id) => `${verbFor(changes.get(id)!.change)} ${id}`).join(', ')
      : `update ${files.length} wiki file(s)`
  const summary = (input.message ?? '').trim()
  if (summary === '' && input.message !== undefined && input.allowEmptyMessage !== true) {
    emitErrorAndExit('BAD_REQUEST', '-m was empty; pass a summary or --allow-empty-message')
  }
  const subject = `wiki: ${summary === '' ? generated : summary}`

  const committed = await git(ctx.projectRoot, ['commit', '-m', subject])
  if (!committed.ok) {
    emitErrorAndExit(
      'GIT_FAILED',
      `git commit failed: ${(committed.stderr || committed.stdout).trim()}`,
      undefined,
      EXIT.GENERIC,
    )
  }
  const sha = (await git(ctx.projectRoot, ['rev-parse', 'HEAD'])).stdout.trim()

  // Post-commit review state per touched page — the handoff message the
  // `memon-wiki` skill has to report.
  const after = await loadWiki(input)
  const pages = pageIds.map((id) => {
    const entry = changes.get(id)!
    const page = after.projection.byId.get(id)
    return {
      id,
      change: verbFor(entry.change),
      paths: entry.paths,
      reviewState: page?.review?.state ?? null,
      verifiedThrough: page?.review?.verifiedThrough ?? null,
    }
  })

  if (format === 'json') {
    emitJson({ sha, shortSha: sha.slice(0, 10), subject, pages, files })
    return
  }
  process.stdout.write(
    `${sha.slice(0, 10)}  ${subject}\n${pages
      .map((page) => `  ${page.change} ${page.id}  ${page.reviewState ?? '—'}`)
      .join('\n')}\n`,
  )
}

function parseNameStatus(stdout: string): { status: string; path: string }[] {
  const tokens = stdout.split('\0').filter((entry) => entry !== '')
  const rows: { status: string; path: string }[] = []
  for (let index = 0; index < tokens.length; index += 1) {
    const status = tokens[index]!
    if (status.startsWith('R') || status.startsWith('C')) {
      // rename/copy: <status>\0<from>\0<to>
      const to = tokens[index + 2]
      if (to !== undefined) rows.push({ status: 'M', path: to })
      index += 2
      continue
    }
    const path = tokens[index + 1]
    if (path !== undefined) rows.push({ status: status[0]!, path })
    index += 1
  }
  return rows
}

function mergeChange(left: string, right: string): string {
  if (left === right) return left
  // A page both added and modified in one index reads as a create; anything
  // else mixed reads as an update.
  if ((left === 'A' && right === 'M') || (left === 'M' && right === 'A')) return 'A'
  return 'M'
}

function verbFor(status: string): string {
  if (status === 'A') return 'create'
  if (status === 'D') return 'delete'
  return 'update'
}

// ---------- memon wiki components (central registry over HTTP) ----------

interface CentralTarget {
  baseUrl: string
  headers: Record<string, string>
}

function resolveCentral(explicit: string | undefined, env: NodeJS.ProcessEnv = process.env): CentralTarget {
  const raw = explicit ?? env.MEMON_CENTRAL_URL
  if (!raw || raw.trim() === '') {
    emitErrorAndExit(
      'BAD_REQUEST',
      'no central dashboard configured: pass --central <url> or set MEMON_CENTRAL_URL',
    )
  }
  const headers: Record<string, string> = { accept: 'application/json' }
  const token = env.MEMON_CENTRAL_TOKEN
  const user = env.MEMON_CENTRAL_USER
  const password = env.MEMON_CENTRAL_PASS
  if (token && token.trim() !== '') {
    headers.authorization = `Bearer ${token.trim()}`
  } else if (user && password) {
    headers.authorization = `Basic ${Buffer.from(`${user}:${password}`, 'utf8').toString('base64')}`
  }
  return { baseUrl: raw.trim().replace(/\/+$/, ''), headers }
}

interface CentralRequest {
  path: string
  method?: 'GET' | 'POST'
  body?: unknown
}

async function centralRequest<T>(target: CentralTarget, request: CentralRequest): Promise<T> {
  const url = `${target.baseUrl}${request.path}`
  const headers = { ...target.headers }
  if (request.body !== undefined) headers['content-type'] = 'application/json'
  let response: Response
  try {
    response = await fetch(url, {
      method: request.method ?? 'GET',
      headers,
      ...(request.body === undefined ? {} : { body: JSON.stringify(request.body) }),
    })
  } catch (err) {
    emitErrorAndExit(
      'CENTRAL_UNREACHABLE',
      `cannot reach central at ${url}: ${(err as Error).message}`,
      undefined,
      EXIT.GENERIC,
    )
  }
  const text = await response.text()
  if (!response.ok) {
    let code = response.status === 404 ? 'NOT_FOUND' : 'CENTRAL_ERROR'
    let message = `central returned ${response.status} for ${url}`
    try {
      const parsed = JSON.parse(text) as { error?: { code?: string; message?: string } }
      if (parsed.error?.code) code = parsed.error.code
      if (parsed.error?.message) message = parsed.error.message
    } catch {
      if (text.trim() !== '') message = `${message}: ${text.trim().slice(0, 200)}`
    }
    emitErrorAndExit(
      code,
      message,
      undefined,
      response.status === 404 ? EXIT.NOT_FOUND : response.status === 400 ? EXIT.USAGE : EXIT.GENERIC,
    )
  }
  if (text.trim() === '') return {} as T
  try {
    return JSON.parse(text) as T
  } catch {
    emitErrorAndExit(
      'CENTRAL_ERROR',
      `central returned non-JSON for ${url}`,
      undefined,
      EXIT.GENERIC,
    )
  }
}

interface CentralComponent {
  name: string
  version: number
  description?: string
  outdated?: boolean
  [key: string]: unknown
}

export interface WikiComponentsLsInput extends WikiCommonInput {
  central?: string
}

export async function runWikiComponentsLs(input: WikiComponentsLsInput): Promise<void> {
  const format = readFormat(input)
  const target = resolveCentral(input.central)
  const result = await centralRequest<{ components?: CentralComponent[] }>(target, {
    path: '/api/wiki/components',
  })
  const components = result.components ?? []
  if (format === 'json') {
    emitJson({ components })
    return
  }
  if (components.length === 0) {
    process.stdout.write('(no registered components)\n')
    return
  }
  process.stdout.write(
    `${components
      .map(
        (component) =>
          `${`${component.name}@${component.version}`.padEnd(24)} ${
            component.outdated === true ? '[outdated]' : '          '
          } ${component.description ?? ''}`.trimEnd(),
      )
      .join('\n')}\n`,
  )
}

export interface WikiComponentsShowInput extends WikiCommonInput {
  name: string
  central?: string
}

export async function runWikiComponentsShow(input: WikiComponentsShowInput): Promise<void> {
  const format = readFormat(input)
  const target = resolveCentral(input.central)
  const descriptor = await centralRequest<Record<string, unknown>>(target, {
    path: `/api/wiki/components/${encodeURIComponent(input.name)}`,
  })
  if (format === 'json') {
    emitJson(descriptor)
    return
  }
  const lines: string[] = []
  for (const [key, value] of Object.entries(descriptor)) {
    lines.push(
      typeof value === 'string'
        ? `${key}: ${value}`
        : `${key}: ${JSON.stringify(value, null, 2).split('\n').join('\n  ')}`,
    )
  }
  process.stdout.write(`${lines.join('\n')}\n`)
}

export interface WikiComponentsMigrateInput extends WikiCommonInput {
  page?: string
  central?: string
  dryRun?: boolean
}

export async function runWikiComponentsMigrate(input: WikiComponentsMigrateInput): Promise<void> {
  const format = readFormat(input)
  const target = resolveCentral(input.central)
  const ctx = await loadWiki(input)
  const summaries =
    input.page === undefined ? ctx.projection.summaries : [resolvePage(ctx, input.page)]

  const results: { id: string; path: string; changed: boolean; written: boolean }[] = []
  for (const summary of summaries) {
    const page = ctx.byPath.get(summary.path)
    if (!page) continue
    const parsed = parseWikiFrontmatter(page.content)
    const response = await centralRequest<{ content?: string }>(target, {
      path: '/api/wiki/components/migrate',
      method: 'POST',
      body: { content: parsed.body },
    })
    if (typeof response.content !== 'string') {
      emitErrorAndExit(
        'CENTRAL_ERROR',
        'central component migration response did not contain a Markdown body',
        undefined,
        EXIT.GENERIC,
      )
    }
    const nextBody = response.content
    const changed = nextBody !== parsed.body
    if (changed && input.dryRun !== true) {
      // The central registry owns component bodies, not wiki frontmatter.
      // Preserve the original frontmatter bytes exactly (including custom
      // keys, key order, quoting, and comments) and replace only the body.
      const bodyOffset = page.content.length - parsed.body.length
      await atomicWrite(page.absolutePath, `${page.content.slice(0, bodyOffset)}${nextBody}`)
    }
    results.push({
      id: summary.id,
      path: summary.path,
      changed,
      written: changed && input.dryRun !== true,
    })
  }

  if (format === 'json') {
    emitJson({ dryRun: input.dryRun === true, pages: results })
    return
  }
  const touched = results.filter((row) => row.changed)
  if (touched.length === 0) {
    process.stdout.write('(no component blocks needed migration)\n')
    return
  }
  process.stdout.write(
    `${touched
      .map((row) => `${row.written ? 'migrated' : 'would migrate'}  ${row.id}  ${row.path}`)
      .join('\n')}\n`,
  )
}
