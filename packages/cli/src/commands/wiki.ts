// `memon wiki` — the wiki command group over
// `<projectRoot>/docs/wiki/<kind>/W<NNNN>-<slug>{.md,/README.md}`.
//
// CLI projection deliberately stops at Wiki files: source-target resolution,
// staleness, and target existence checks belong to the Web runtime. The CLI
// preserves and validates source syntax without walking unrelated artifacts.
//
// Two deliberate boundaries:
//   - Component descriptors live ONLY in the central dashboard; nothing about
//     a component is compiled into the CLI artifact. `memon components run`
//     executes blocks locally through `@memon/core` without any descriptor.
//   - git is invoked only through the shared core command seam with an argv
//     array (never a shell string), and only by `commit`. Every other command is a pure Wiki-file read — no worktree
//     probe, no marks, no log/status/blame — so it behaves identically
//     outside a git worktree.
//
// Exit codes: 0 ok, 1 `lint --strict` failure / generic, 2 BAD_REQUEST,
// 4 NOT_FOUND (incl. NOT_A_GIT_PROJECT), 9 CONFLICT /
// MIXED_INDEX. Errors are one `{"error":{"code","message"}}` object on stderr.

import { type Dirent, promises as fs } from 'node:fs'
import { dirname, join } from 'node:path'

import {
  buildWikiProject,
  cachedGitCommand,
  type DiscoveredWikiPage,
  discoverWikiPages,
  EXPERIMENT_REF_REGEX,
  extractRunMentions,
  formatIsoLocal,
  getWikiKind,
  gitCommandStdoutText,
  isGitCommandFailure,
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
  WIKI_KIND_DEFINITIONS,
  WIKI_KIND_REGISTRY,
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
const GIT_TIMEOUT_MS = 30_000
const GIT_MAX_BUFFER = 64 * 1024 * 1024
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

// ---------- project load ----------

export async function runWikiKinds(input: WikiCommonInput & { kind?: string }): Promise<void> {
  const format = readFormat(input)
  const selected = input.kind === undefined ? undefined : getWikiKind(assertKind(input.kind))
  if (format === 'json') {
    emitJson(selected ?? WIKI_KIND_REGISTRY)
    return
  }
  const kinds = selected ? [selected] : WIKI_KIND_DEFINITIONS
  for (const kind of kinds) {
    process.stdout.write(`${kind.id} — ${kind.label}\n${kind.zh.purpose}\n`)
    if (!selected) continue
    process.stdout.write(
      [
        `适用：${kind.zh.uses.join('；')}`,
        `示例：${kind.zh.examples.join('；')}`,
        `区别：${kind.zh.distinctions}`,
        `Status: ${kind.policy.statuses.join(' | ') || 'none'}`,
        `Date required: ${kind.policy.dateRequired}; sources required: ${kind.policy.sourcesRequired}`,
        `Recommended H2 (advisory): ${kind.policy.recommendedHeadings.join(', ') || 'none'}`,
        `Required H2: none`,
        `Authoring: ${kind.en.purpose} ${kind.en.authoring}`,
        `Examples: ${kind.en.examples.join('; ')}`,
        `Distinctions: ${kind.en.distinctions}`,
        '',
      ].join('\n'),
    )
  }
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

/** Raw source aliases derivable from syntax alone, without target lookup. */
function sourceKeys(source: string): string[] {
  const match = EXPERIMENT_REF_REGEX.exec(source)
  if (!match) return [source]
  const head = source.split('/')[0]!
  return [...new Set([source, head, match[1]!])]
}

// ---------- memon wiki ls ----------

export interface WikiLsInput extends WikiCommonInput {
  kind?: string
  status?: string
  tag?: string
  source?: string
  deprecated?: boolean
  description?: boolean
}

export async function runWikiLs(input: WikiLsInput): Promise<void> {
  const format = readFormat(input, true)
  const ctx = await loadWiki(input)

  const pages = ctx.projection.summaries.filter((summary) => {
    if (input.kind !== undefined && summary.kind !== input.kind) return false
    if (input.status !== undefined && summary.status !== input.status) return false
    if (input.tag !== undefined && !summary.tags.includes(input.tag)) return false
    if (input.deprecated === true && summary.deprecated === null) return false
    if (input.deprecated === false && summary.deprecated !== null) return false
    if (
      input.source !== undefined &&
      !summary.sources.some((source) => sourceKeys(source).includes(input.source!))
    ) {
      return false
    }
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
      out.push('| id | path | status | updated_at | title | description |')
      out.push('| --- | --- | --- | --- | --- | --- |')
    }
    const cells = [
      page.id,
      `\`${page.path}\``,
      page.status ?? '—',
      page.updatedAt,
      page.deprecated ? `${page.title} [deprecated]` : page.title,
      showDescription ? (page.description ?? '') : '',
    ]
    out.push(
      `| ${cells.map((cell) => cell.replace(/\|/g, '\\|').replace(/\n+/g, ' ')).join(' | ')} |`,
    )
  }
  return `${out.join('\n')}\n`
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

// ---------- memon wiki set ----------

export interface WikiSetInput extends WikiCommonInput {
  page: string
  status?: string
  title?: string
  description?: string
  date?: string
  language?: string
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
    input.language,
    input.addSource?.length ? 'x' : undefined,
    input.rmSource?.length ? 'x' : undefined,
    input.addTag?.length ? 'x' : undefined,
    input.rmTag?.length ? 'x' : undefined,
  ].filter((value) => value !== undefined)
  if (changes.length === 0) {
    emitErrorAndExit(
      'BAD_REQUEST',
      'at least one change flag is required: --status --title --description --date --language --add-source --rm-source --add-tag --rm-tag',
    )
  }
  if (input.date !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(input.date)) {
    emitErrorAndExit('BAD_REQUEST', `--date must be YYYY-MM-DD; got "${input.date}"`)
  }
  const language = assertLanguage(input.language)

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
    emitErrorAndExit(
      'BAD_REQUEST',
      `${summary.path} has no readable YAML frontmatter; fix it by hand first`,
    )
  }

  const patch: Record<string, unknown> = { updated_at: formatIsoLocal(new Date()) }
  if (input.status !== undefined) patch.status = input.status
  if (input.title !== undefined) patch.title = input.title
  if (input.description !== undefined) patch.description = input.description
  if (input.date !== undefined) patch.date = input.date
  if (language !== undefined) patch.language = language
  const sources = applyListEdit(summary.sources, input.addSource, input.rmSource)
  if (sources) patch.sources = sources
  const tags = applyListEdit(summary.tags, input.addTag, input.rmTag)
  if (tags) patch.tags = tags

  await writeFileAtomic(
    page.absolutePath,
    serializeWikiPage(updateWikiFrontmatter(parsed.frontmatter, patch), parsed.body),
  )
  await emitPageResult(ctx, format, summary.path)
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
    emitErrorAndExit(
      'BAD_REQUEST',
      `--at must be ISO8601 with an explicit offset; got "${input.at}"`,
    )
  }
  const ctx = await loadWiki(input)
  const summary = resolvePage(ctx, input.page)
  const page = discovered(ctx, summary)
  if (input.supersededBy !== undefined) {
    if (!WIKI_ID_REGEX.test(input.supersededBy)) {
      emitErrorAndExit(
        'BAD_REQUEST',
        `--superseded-by must be a canonical W<NNNN> id; got "${input.supersededBy}"`,
      )
    }
  }

  const parsed = parseWikiFrontmatter(page.content)
  if (!parsed.frontmatter) {
    emitErrorAndExit(
      'BAD_REQUEST',
      `${summary.path} has no readable YAML frontmatter; fix it by hand first`,
    )
  }
  const now = formatIsoLocal(new Date())
  const deprecated: Record<string, unknown> = {
    at: input.at ?? now,
    reason: input.reason.trim(),
    ...(input.supersededBy === undefined ? {} : { superseded_by: input.supersededBy }),
  }
  await writeFileAtomic(
    page.absolutePath,
    serializeWikiPage(
      updateWikiFrontmatter(parsed.frontmatter, { deprecated, updated_at: now }),
      parsed.body,
    ),
  )
  await emitPageResult(ctx, format, summary.path)
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
    emitErrorAndExit(
      'BAD_REQUEST',
      `${summary.path} has no readable YAML frontmatter; fix it by hand first`,
    )
  }
  await writeFileAtomic(
    page.absolutePath,
    serializeWikiPage(
      updateWikiFrontmatter(parsed.frontmatter, {
        deprecated: undefined,
        updated_at: formatIsoLocal(new Date()),
      }),
      parsed.body,
    ),
  )
  await emitPageResult(ctx, format, summary.path)
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
}

export async function runWikiLint(input: WikiLintInput): Promise<void> {
  const format = readFormat(input)
  // A pure Wiki-file read: no CLI diagnostic depends on review state, so lint
  // never spawns git — not even for a `status: VERIFIED` finding.
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
      summary: {
        pages: rows.length,
        errors,
        warnings,
        strict: input.strict === true,
        sourceResolution: 'web-only',
      },
    })
  } else {
    const lines: string[] = []
    for (const row of rows) {
      if (row.diagnostics.length === 0) continue
      lines.push(`${row.id}  ${row.path}`)
      for (const diagnostic of row.diagnostics) lines.push(formatDiagnostic(diagnostic))
    }
    lines.push(`${rows.length} page(s), ${errors} error(s), ${warnings} warning(s)`)
    lines.push('source target resolution: Web only')
    process.stdout.write(`${lines.join('\n')}\n`)
  }

  if (input.strict === true && errors > 0) process.exitCode = EXIT.GENERIC
}

// ---------- memon wiki backlinks ----------

export interface WikiBacklinksInput extends WikiCommonInput {
  artifact: string
}

interface CliWikiBacklink {
  id: string
  slug: string
  kind: string
  title: string
  status: string | null
  deprecated: boolean
  updatedAt: string
}

export async function runWikiBacklinks(input: WikiBacklinksInput): Promise<void> {
  const format = readFormat(input)
  const ctx = await loadWiki(input)
  const pages: CliWikiBacklink[] = ctx.projection.summaries
    .filter((summary) =>
      summary.sources.some((source) => sourceKeys(source).includes(input.artifact)),
    )
    .sort((left, right) => {
      const updated = Date.parse(right.updatedAt) - Date.parse(left.updatedAt)
      return updated !== 0 ? updated : left.id.localeCompare(right.id)
    })
    .map((summary) => ({
      id: summary.id,
      slug: summary.slug,
      kind: summary.kind,
      title: summary.title,
      status: summary.status,
      deprecated: summary.deprecated !== null,
      updatedAt: summary.updatedAt,
    }))

  if (format === 'json') {
    emitJson({ artifact: input.artifact, pages })
    return
  }
  const lines = [`artifact: ${input.artifact}`]
  if (pages.length === 0) lines.push('(no citing pages)')
  for (const row of pages) {
    const badges = [
      row.status ? `[${row.status}]` : null,
      row.deprecated ? '[deprecated]' : null,
    ].filter((badge): badge is string => badge !== null)
    lines.push(`${row.id}  ${row.kind}  ${badges.join(' ')}  ${row.title}`)
  }
  process.stdout.write(`${lines.join('\n')}\n`)
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

// ---------- git plumbing (commit) ----------

interface GitResult {
  ok: boolean
  stdout: string
  stderr: string
}

/**
 * The commit command reads the index on both sides of its own staging.
 * Staging and committing are mutations, which the cache runs uncached and
 * fences with an invalidation, so no read here can observe a pre-staging
 * index afterwards.
 */
const gitCommand = cachedGitCommand()

/**
 * `cache: 'bypass'` is for the reads a decision is made from — the mixed-index
 * preflight and the sha of the commit just written — which must observe the
 * repository as it is, not as it was when something else read it.
 */
async function git(
  projectRoot: string,
  args: string[],
  cache: 'use' | 'bypass' = 'use',
): Promise<GitResult> {
  const result = await gitCommand('git', args, {
    cwd: projectRoot,
    timeoutMs: GIT_TIMEOUT_MS,
    maxBuffer: GIT_MAX_BUFFER,
    cache,
  })
  const stdout = gitCommandStdoutText(result)
  if (!isGitCommandFailure(result)) return { ok: true, stdout, stderr: result.stderr }
  // `rev-parse --verify --quiet HEAD` tells an unborn HEAD (exit 1, *empty*
  // stderr) from a real failure by this field, so a plain non-zero exit keeps
  // git's own stderr verbatim. Only a command that never ran — missing binary,
  // killed by our timeout — reports the transport diagnostic instead.
  const silentTransportFailure =
    (result.spawnFailed === true || result.timedOut === true) && result.stderr === ''
  return {
    ok: false,
    stdout,
    stderr: silentTransportFailure ? (result.message ?? 'git failed') : result.stderr,
  }
}

/** The commit command needs a usable git worktree. */
async function requireGitWorktree(projectRoot: string): Promise<void> {
  const result = await git(projectRoot, ['rev-parse', '--is-inside-work-tree'])
  if (!result.ok || result.stdout.trim() !== 'true') {
    emitErrorAndExit(
      'NOT_A_GIT_PROJECT',
      `${projectRoot} is not inside a git worktree; wiki commit needs git`,
      undefined,
      EXIT.NOT_FOUND,
    )
  }
}

// ---------- memon wiki commit ----------

export interface WikiCommitInput extends WikiCommonInput {
  message?: string
  allowEmptyMessage?: boolean
  /** Pages (id or slug) to commit; empty commits every wiki change. */
  pages?: string[]
  noPush?: boolean
}

/** Where a successful commit landed, or why it was not pushed. */
interface WikiPushResult {
  status: 'pushed' | 'skipped'
  remote?: string
  branch?: string
}

export async function runWikiCommit(input: WikiCommitInput): Promise<void> {
  const format = readFormat(input)
  const projectRoot = singleProjectRoot(await resolveContext(input))
  await requireGitWorktree(projectRoot)

  const prefix = (await git(projectRoot, ['rev-parse', '--show-prefix'])).stdout.trim()
  const wikiPrefix = `${prefix}${WIKI_DIR_RELPATH}/`

  // Named pages commit only their own paths, so the index belongs to whoever
  // staged it: no mixed-index refusal, no `docs/wiki`-wide staging.
  const scope = await commitScope(input)

  if (scope === null) {
    // Refusing a mixed index is a safety decision about the index as it is now.
    const alreadyStaged = (
      await git(projectRoot, ['diff', '--cached', '--name-only', '-z'], 'bypass')
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
  }

  const pathspecs = scope?.pathspecs ?? [WIKI_DIR_RELPATH]
  if (scope !== null || (await exists(join(projectRoot, WIKI_DIR_RELPATH)))) {
    for (const pathspec of pathspecs) {
      const staged = await git(projectRoot, ['add', '-A', '--', pathspec])
      // A page with no file of its own left (already deleted and committed)
      // is not an error here; the "nothing to commit" check below decides.
      if (staged.ok || staged.stderr.includes('did not match any files')) continue
      emitErrorAndExit(
        'GIT_FAILED',
        `git add failed: ${staged.stderr.trim()}`,
        undefined,
        EXIT.GENERIC,
      )
    }
  }

  const statusRows = parseNameStatus(
    (await git(projectRoot, ['diff', '--cached', '--name-status', '-z', '--', ...pathspecs]))
      .stdout,
  )
  if (statusRows.length === 0) {
    emitErrorAndExit(
      'BAD_REQUEST',
      scope === null
        ? `nothing to commit under ${WIKI_DIR_RELPATH}/`
        : `nothing to commit for ${scope.ids.join(', ')}`,
    )
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

  const committed = await git(
    projectRoot,
    scope === null
      ? ['commit', '-m', subject]
      : // `--only` commits exactly these files, so whatever another writer
        // staged stays staged and uncommitted.
        ['commit', '--only', '-m', subject, '--', ...files],
  )
  if (!committed.ok) {
    emitErrorAndExit(
      'GIT_FAILED',
      `git commit failed: ${(committed.stderr || committed.stdout).trim()}`,
      undefined,
      EXIT.GENERIC,
    )
  }
  const sha = (await git(projectRoot, ['rev-parse', 'HEAD'], 'bypass')).stdout.trim()

  const pages = pageIds.map((id) => ({
    id,
    change: verbFor(changes.get(id)!.change),
    paths: changes.get(id)!.paths,
  }))

  const push = await pushCommit(projectRoot, sha, input.noPush === true)

  if (format === 'json') {
    emitJson({ sha, shortSha: sha.slice(0, 10), subject, pages, files, push })
    return
  }
  const destination =
    push.status === 'pushed' ? `pushed to ${push.remote}/${push.branch}` : 'not pushed (--no-push)'
  process.stdout.write(
    `${sha.slice(0, 10)}  ${subject}\n${pages
      .map((page) => `  ${page.change} ${page.id}`)
      .join('\n')}\n${destination}\n`,
  )
}

/**
 * Page arguments resolved to the pathspecs that cover every file a page can
 * own: the Markdown file, the bundle directory, `<stem>__assets/`, and the
 * same id under another kind or slug (a move or rename). A `W<NNNN>` id is
 * taken as written so a deleted page can still be committed; anything else is
 * resolved as a slug. `null` means "every wiki change", the default scope.
 */
async function commitScope(
  input: WikiCommitInput,
): Promise<{ ids: string[]; pathspecs: string[] } | null> {
  const refs = (input.pages ?? []).map((ref) => ref.trim()).filter((ref) => ref !== '')
  if (refs.length === 0) return null
  const ids: string[] = []
  let ctx: WikiContext | null = null
  for (const ref of refs) {
    let id = ref
    if (!WIKI_ID_REGEX.test(ref)) {
      ctx ??= await loadWiki(input)
      id = resolvePage(ctx, ref).id
    }
    if (!ids.includes(id)) ids.push(id)
  }
  // Default pathspec magic: `*` spans `/`, so one pattern per id covers the
  // Markdown file, the bundle directory, `<stem>__assets/`, and the same id
  // under another kind or slug.
  return { ids, pathspecs: ids.map((id) => `${WIKI_DIR_RELPATH}/*/${id}-*`) }
}

/**
 * Publish the branch as it now stands — the new commit and any earlier local
 * one — with a plain non-force push. A push that cannot happen leaves the
 * commit in place and fails loudly: integrating diverged history (fetch,
 * rebase, merge, force) is the owner's call, never this command's.
 */
async function pushCommit(
  projectRoot: string,
  sha: string,
  skip: boolean,
): Promise<WikiPushResult> {
  if (skip) return { status: 'skipped' }
  const upstream = await git(
    projectRoot,
    ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}'],
    'bypass',
  )
  const tracked = upstream.stdout.trim()
  const separator = tracked.indexOf('/')
  if (!upstream.ok || separator <= 0) {
    emitErrorAndExit(
      'PUSH_FAILED',
      `commit ${sha} was created but not pushed: the current branch has no upstream branch; set one with \`git push -u <remote> <branch>\``,
      { sha },
      EXIT.GENERIC,
    )
  }
  const remote = tracked.slice(0, separator)
  const branch = tracked.slice(separator + 1)
  const pushed = await git(projectRoot, ['push', remote, `HEAD:${branch}`], 'bypass')
  if (!pushed.ok) {
    emitErrorAndExit(
      'PUSH_FAILED',
      `commit ${sha} was created but the push to ${remote}/${branch} failed: ${(
        pushed.stderr || pushed.stdout
      ).trim()}`,
      { sha, remote, branch },
      EXIT.GENERIC,
    )
  }
  return { status: 'pushed', remote, branch }
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
