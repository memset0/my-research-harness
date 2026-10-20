// Wiki reads and optional allocation, move and Report migration. Source targets are not hydrated.

import { type Dirent, promises as fs } from 'node:fs'
import { dirname, join } from 'node:path'

import {
  buildWikiProject,
  type DiscoveredWikiPage,
  discoverWikiPages,
  extractRunMentions,
  formatIsoLocal,
  getWikiKind,
  isWikiLanguage,
  padId,
  parseId,
  parseWikiFrontmatter,
  REPORT_FILENAME_REGEX,
  RUN_MENTION_SOURCE,
  SLUG_SOURCE,
  serializeWikiPage,
  updateWikiFrontmatter,
  WIKI_DIR_RELPATH,
  WIKI_ID_REGEX,
  WIKI_KINDS,
  WIKI_LANGUAGES,
  WIKI_PAGE_NAME_REGEX,
  WIKI_RECOMMENDED_SECTIONS,
  WIKI_RESERVED_KINDS,
  WIKI_SLUG_REGEX,
  WIKI_STATUS_BY_KIND,
  WIKI_TIMESTAMP_REGEX,
  type WikiDiagnostic,
  type WikiFrontmatter,
  type WikiKind,
  type WikiLanguage,
  type WikiProjectProjection,
  type WikiSummary,
  wikiContentHash,
  wikiStringList,
  writeFileAtomic,
} from '@memon/core'

import { resolveContext, singleProjectRoot } from '../lib/context.js'
import { emitErrorAndExit } from '../lib/emit-error.js'
import { EXIT } from '../lib/exit-codes.js'
import { emitJson } from '../lib/output.js'

const REPORT_DIR_REGEX = new RegExp(`^R(\\d{4})-(${SLUG_SOURCE})$`)
const REPORTS_SUBDIR = 'docs/reports'
/** Evidence tokens a migrated Report body can supply as `sources`. */
const EVIDENCE_TOKEN_REGEX = new RegExp(
  `\\b(E\\d{4}(?:-${SLUG_SOURCE})?(?:\\/V\\d{4})?|H\\d{4}|${RUN_MENTION_SOURCE})\\b`,
  'g',
)
const LEGACY_RUN_MENTION = new RegExp(RUN_MENTION_SOURCE)
const WIKI_BUNDLE_MAX_DEPTH = 8
const WIKI_BUNDLE_MAX_FILES = 5000

export type WikiFormat = 'json' | 'human' | 'markdown'

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

interface WikiContext {
  projectRoot: string
  pages: DiscoveredWikiPage[]
  byPath: Map<string, DiscoveredWikiPage>
  projection: WikiProjectProjection
}

function projectWiki(projectRoot: string, pages: DiscoveredWikiPage[]): WikiContext {
  return {
    projectRoot,
    pages,
    byPath: new Map(pages.map((page) => [page.path, page])),
    projection: buildWikiProject(pages, { resolveSourceTargets: false }),
  }
}

/**
 * Load Wiki files without Git or source-target directory scans.
 */
async function loadWiki(input: WikiCommonInput): Promise<WikiContext> {
  const projectRoot = singleProjectRoot(await resolveContext(input))
  return projectWiki(projectRoot, await discoverWikiPages(projectRoot))
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

/** Locate one explicitly requested Report without reading unrelated Reports. */
async function discoverReport(
  projectRoot: string,
  reportId: string,
): Promise<DiscoveredReport | null> {
  const dir = join(projectRoot, REPORTS_SUBDIR)
  let entries: Dirent[]
  try {
    entries = await fs.readdir(dir, { withFileTypes: true })
  } catch {
    return null
  }
  for (const entry of entries) {
    if (entry.isDirectory()) {
      const match = REPORT_DIR_REGEX.exec(entry.name)
      if (!match || `R${match[1]}` !== reportId) continue
      const readme = join(dir, entry.name, 'README.md')
      if (!(await exists(readme))) continue
      return {
        id: reportId,
        slug: match[2]!,
        format: 'bundle',
        path: `${REPORTS_SUBDIR}/${entry.name}/README.md`,
        absolutePath: readme,
        bundleDir: join(dir, entry.name),
      }
    }
    const match = REPORT_FILENAME_REGEX.exec(entry.name)
    if (!match || `R${match[1]}` !== reportId) continue
    return {
      id: reportId,
      slug: match[2]!,
      format: 'markdown',
      path: `${REPORTS_SUBDIR}/${entry.name}`,
      absolutePath: join(dir, entry.name),
      bundleDir: null,
    }
  }
  return null
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
  const vocabulary = WIKI_STATUS_BY_KIND[kind] ?? []
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

/** `--language` on `create` / `set`: the declared content language, if any. */
function assertLanguage(value: string | undefined): WikiLanguage | undefined {
  if (value === undefined) return undefined
  if (!isWikiLanguage(value)) {
    emitErrorAndExit(
      'BAD_REQUEST',
      `--language must be one of ${WIKI_LANGUAGES.join('|')}; got "${value}"`,
    )
  }
  return value
}

function assertSlugFree(ctx: WikiContext, slug: string, allowId?: string): void {
  const taken = ctx.projection.bySlug.get(slug)
  if (taken && taken.id !== allowId) {
    emitErrorAndExit('CONFLICT', `slug "${slug}" is already used by ${taken.id} at ${taken.path}`, {
      id: taken.id,
      path: taken.path,
    })
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

type CliWikiSummary = Omit<WikiSummary, 'mtime' | 'stale' | 'staleSources'>

/**
 * CLI summary: target-derived staleness is Web-only.
 */
function listEntry(summary: WikiSummary): CliWikiSummary {
  const { mtime: _mtime, stale: _stale, staleSources: _staleSources, ...rest } = summary
  return rest
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
    emitJson({ ...listEntry(summary), content, hash: wikiContentHash(page.content) })
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
    'source resolution: Web only',
  ]
  if (summary.deprecated) {
    lines.push(
      `deprecated: ${summary.deprecated.at} — ${summary.deprecated.reason}${
        summary.deprecated.superseded_by
          ? ` (superseded by ${summary.deprecated.superseded_by})`
          : ''
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
  language?: string
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
  if (
    getWikiKind(kind)?.policy.dateRequired &&
    (input.date === undefined || input.date.trim() === '')
  ) {
    emitErrorAndExit('BAD_REQUEST', `\`${kind}\` pages require --date <YYYY-MM-DD>`)
  }
  if (input.date !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(input.date)) {
    emitErrorAndExit('BAD_REQUEST', `--date must be YYYY-MM-DD; got "${input.date}"`)
  }
  const language = assertLanguage(input.language)

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
    ...(language === undefined ? {} : { language }),
    ...(input.source && input.source.length > 0 ? { sources: input.source } : {}),
    ...(input.tag && input.tag.length > 0 ? { tags: input.tag } : {}),
    created_at: now,
    updated_at: now,
  }

  const sections = WIKI_RECOMMENDED_SECTIONS[kind] ?? []
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
    await fs.writeFile(absolute, serializeWikiPage(frontmatter, body), {
      encoding: 'utf8',
      flag: 'wx',
    })
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'EEXIST') {
      emitErrorAndExit('CONFLICT', `${relative} already exists`)
    }
    throw err
  }

  await emitPageResult(ctx, format, relative, { absolutePath: absolute })
}

async function readWikiPageAt(
  projectRoot: string,
  relative: string,
): Promise<DiscoveredWikiPage | null> {
  const parts = relative.split('/')
  if (parts[0] !== 'docs' || parts[1] !== 'wiki' || parts.length < 4) return null
  const format = relative.endsWith('/README.md') ? 'bundle' : 'markdown'
  const name = format === 'bundle' ? parts.at(-2)! : parts.at(-1)!.replace(/\.md$/, '')
  const match = WIKI_PAGE_NAME_REGEX.exec(name)
  if (!match) return null
  const absolutePath = join(projectRoot, relative)
  try {
    const [content, stat] = await Promise.all([
      fs.readFile(absolutePath, 'utf8'),
      fs.stat(absolutePath),
    ])
    const bundleDir = format === 'bundle' ? dirname(absolutePath) : null
    const assets = bundleDir === null ? [] : await listWikiBundleFiles(bundleDir)
    return {
      id: match[1]!,
      slug: match[2]!,
      kind: parts[2]!,
      format,
      path: relative,
      absolutePath,
      bundleDir,
      content,
      mtime: stat.mtimeMs,
      bundleMtime: stat.mtimeMs,
      assets,
    }
  } catch {
    return null
  }
}

async function listWikiBundleFiles(root: string, prefix = '', depth = 1): Promise<string[]> {
  if (depth > WIKI_BUNDLE_MAX_DEPTH) return []
  const entries = await fs.readdir(join(root, prefix), { withFileTypes: true })
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const relative = prefix === '' ? entry.name : `${prefix}/${entry.name}`
      if (entry.isDirectory()) {
        return depth < WIKI_BUNDLE_MAX_DEPTH ? listWikiBundleFiles(root, relative, depth + 1) : []
      }
      return entry.isFile() ? [relative] : []
    }),
  )
  return nested.flat().sort().slice(0, WIKI_BUNDLE_MAX_FILES)
}

async function changedPageSummary(ctx: WikiContext, path: string): Promise<WikiSummary> {
  const page = await readWikiPageAt(ctx.projectRoot, path)
  if (!page) emitErrorAndExit('NOT_FOUND', `wiki page at ${path} could not be re-read`)
  const projection = buildWikiProject([page], { resolveSourceTargets: false })
  return projection.summaries[0]!
}

async function emitPageResult(
  ctx: WikiContext,
  format: WikiFormat,
  path: string,
  extra: Record<string, unknown> = {},
): Promise<void> {
  const summary = await changedPageSummary(ctx, path)
  if (format === 'json') {
    emitJson({ ...listEntry(summary), ...extra })
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
    emitErrorAndExit(
      'BAD_REQUEST',
      `target must be "<kind>" or "<kind>/<slug>"; got "${input.target}"`,
    )
  }
  const kind = assertKind(rawKind)

  const ctx = await loadWiki(input)
  const summary = resolvePage(ctx, input.page)
  const page = discovered(ctx, summary)
  const slug = rawSlug === undefined ? summary.slug : assertSlug(rawSlug)
  assertSlugFree(ctx, slug, summary.id)

  const vocabulary = WIKI_STATUS_BY_KIND[kind] ?? []
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
    await writeFileAtomic(
      readme,
      serializeWikiPage(updateWikiFrontmatter(parsed.frontmatter, patch), parsed.body),
    )
  }

  await emitPageResult(ctx, format, newRelative, { oldPath: summary.path, newPath: newRelative })
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
  const report = await discoverReport(ctx.projectRoot, input.report)
  if (!report) {
    emitErrorAndExit('NOT_FOUND', `report "${input.report}" not found under ${REPORTS_SUBDIR}/`)
  }
  const slug = assertSlug(input.slug ?? report.slug)
  assertSlugFree(ctx, slug)
  const id = nextWikiId(ctx)

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
    if (getWikiKind(kind)?.policy.dateRequired && typeof existing.date !== 'string') {
      const created = typeof patch.created_at === 'string' ? patch.created_at : existing.created_at
      if (typeof created === 'string') patch.date = created.slice(0, 10)
    }
    if (
      getWikiKind(kind)?.policy.sourcesRequired &&
      wikiStringList(existing.sources).length === 0
    ) {
      const derived = deriveSources(body)
      if (derived.length > 0) patch.sources = derived
    }

    await writeFileAtomic(readme, serializeWikiPage(updateWikiFrontmatter(existing, patch), body))

    // Lint only the page in its new home before the Report is destroyed.
    const summary = await changedPageSummary(ctx, newRelative)
    const errors = summary.diagnostics.filter((d) => d.severity === 'error')
    if (errors.length > 0) {
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
        page: listEntry(summary),
      })
      return
    }
    process.stdout.write(
      `${report.id} ${report.path} -> ${summary.id} ${newRelative}\n${renderShowHeader(summary)}`,
    )
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
  // Discoverable Run names the legacy token cannot see (non-ASCII, dots…).
  for (const name of extractRunMentions(body)) {
    if (!LEGACY_RUN_MENTION.test(name) && !out.includes(name)) out.push(name)
  }
  return out
}
