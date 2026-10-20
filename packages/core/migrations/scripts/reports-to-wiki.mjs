#!/usr/bin/env node
import { createHash, randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import {
  discoverWikiPages,
  extractRunMentions,
  formatIsoLocal,
  getWikiKind,
  isOffsetTimestamp,
  lintWikiPage,
  padId,
  parseWikiFrontmatter,
  rebuildIndex,
  serializeWikiPage,
  updateWikiFrontmatter,
  WIKI_KINDS,
  WIKI_RESERVED_KINDS,
  WIKI_SLUG_REGEX,
  WIKI_STATUS_BY_KIND,
  wikiStringList,
  withFileWriterLock,
} from '../../dist/index.js'
import { argumentsFor, contained, runScript } from './runtime.mjs'

async function snapshot(root, path) {
  const hash = createHash('sha256')
  let count = 0
  async function walk(path) {
    if (++count > 5000) throw new Error('Report bundle exceeds 5000 entries')
    await contained(root, path)
    const stat = await fs.lstat(path)
    hash.update(JSON.stringify([relative(root, path), stat.mode]))
    if (stat.isSymbolicLink()) hash.update(await fs.readlink(path))
    else if (stat.isDirectory()) {
      for (const name of (await fs.readdir(path)).sort()) await walk(join(path, name))
    } else if (stat.isFile()) hash.update(await fs.readFile(path))
    else throw new Error('Unsupported Report entry')
  }
  await walk(path)
  return hash.digest('hex')
}

async function relocateAssetLinks(root, oldRoot, newRoot, path = newRoot) {
  const stat = await fs.lstat(path)
  if (stat.isDirectory()) {
    for (const name of await fs.readdir(path))
      await relocateAssetLinks(root, oldRoot, newRoot, join(path, name))
  } else if (stat.isSymbolicLink()) {
    const source = join(oldRoot, relative(newRoot, path))
    const target = await contained(root, await fs.realpath(source))
    const within = relative(oldRoot, target)
    const movedTarget =
      within === '' || (!within.startsWith('../') && within !== '..')
        ? join(newRoot, within)
        : target
    await fs.unlink(path)
    await fs.symlink(relative(dirname(path), movedTarget), path)
  }
}

export async function migrateReport(options) {
  const root = await fs.realpath(options['project-root'])
  const work = async () => {
    if (!/^R\d{4}$/.test(options.report ?? '')) throw new Error('Use a canonical R<NNNN> id')
    const kind = options.kind
    if (!WIKI_KINDS.includes(kind) || WIKI_RESERVED_KINDS.includes(kind))
      throw new Error('Choose a supported non-reserved Wiki kind')
    const vocabulary = WIKI_STATUS_BY_KIND[kind] ?? []
    const status = options.status ?? vocabulary[0]
    if (status !== undefined && !vocabulary.includes(status)) throw new Error('Invalid status')
    const reports = await contained(root, 'docs/reports')
    const matches = (await fs.readdir(reports, { withFileTypes: true })).filter(
      (entry) =>
        entry.name.startsWith(`${options.report}-`) &&
        (entry.isDirectory() || (entry.isFile() && entry.name.endsWith('.md'))),
    )
    if (matches.length !== 1) throw new Error('Report missing or ambiguous')
    const entry = matches[0]
    const bundle = entry.isDirectory()
    const oldRoot = await contained(root, join(reports, entry.name))
    const oldReadme = bundle ? join(oldRoot, 'README.md') : oldRoot
    await contained(root, oldReadme)
    if (!(await fs.lstat(oldReadme)).isFile())
      throw new Error(
        'Report README must be a regular file; resolve linked documents before conversion',
      )
    const slug = options.slug ?? entry.name.slice(6).replace(bundle ? /$^/ : /\.md$/, '')
    if (!WIKI_SLUG_REGEX.test(slug)) throw new Error('Invalid slug')
    const sourceHash = await snapshot(root, oldRoot)
    const sourceMtime = (await fs.stat(oldReadme)).mtimeMs
    if (options['expected-hash'] && options['expected-hash'] !== sourceHash)
      throw new Error('CONFLICT: Report changed since preview')
    const pages = await discoverWikiPages(root)
    let max = 0
    for (const page of pages) {
      const metadata = parseWikiFrontmatter(page.content).frontmatter
      if (page.slug === slug || metadata?.legacy_id === options.report)
        throw new Error('Wiki slug or legacy identity already exists')
      for (const id of [page.id, metadata?.id])
        if (typeof id === 'string' && /^W\d{4}$/.test(id)) max = Math.max(max, Number(id.slice(1)))
    }
    if (max >= 9999) throw new Error('Wiki id space exhausted')
    const id = padId('W', max + 1)
    const newRelative = `docs/wiki/${kind}/${id}-${slug}${bundle ? '/README.md' : '.md'}`
    const newReadme = await contained(root, newRelative)
    const newRoot = bundle ? dirname(newReadme) : newReadme
    const parsed = parseWikiFrontmatter(await fs.readFile(oldReadme, 'utf8'))
    const existing = parsed.frontmatter ?? {}
    const body = parsed.body
    const createdAt =
      typeof existing.created_at === 'string' && isOffsetTimestamp(existing.created_at)
        ? existing.created_at
        : options['created-at']
    if (typeof createdAt !== 'string' || !isOffsetTimestamp(createdAt))
      throw new Error(
        'Missing/invalid historical created_at; supply --created-at with a numeric offset',
      )
    const patch = {
      id,
      kind,
      legacy_id: options.report,
      created_at: createdAt,
      updated_at: formatIsoLocal(new Date()),
      status,
    }
    if (typeof existing.title !== 'string' || !existing.title.trim())
      patch.title = /^ {0,3}#\s+(.+)$/m.exec(body)?.[1] ?? slug
    if (getWikiKind(kind)?.policy.dateRequired && !existing.date)
      patch.date = createdAt.slice(0, 10)
    if (getWikiKind(kind)?.policy.sourcesRequired && !wikiStringList(existing.sources).length)
      patch.sources = [
        ...new Set(
          [...body.matchAll(/\b(E\d{4}(?:-[a-z0-9-]+)?(?:\/V\d{4})?|H\d{4})\b/g)]
            .map((match) => match[1])
            .concat(extractRunMentions(body)),
        ),
      ]
    const frontmatter = updateWikiFrontmatter(existing, patch)
    const diagnostics = lintWikiPage({
      id,
      slug,
      kind,
      path: newRelative,
      format: bundle ? 'bundle' : 'markdown',
      frontmatter,
      body,
    })
    const errors = diagnostics.filter((item) => item.severity === 'error')
    if (errors.length) throw new Error(`Invalid migrated page: ${JSON.stringify(errors)}`)
    const plan = {
      oldPath: relative(root, oldReadme),
      newPath: newRelative,
      sourceHash,
      sourceMtime,
      diagnostics,
      id,
      legacyId: options.report,
    }
    if (!options.apply) return { ...plan, applied: false }

    const backup = await contained(root, `.memon/migrations/reports-to-wiki/${randomUUID()}`)
    await fs.mkdir(backup, { recursive: true })
    await fs.writeFile(join(backup, '.gitignore'), '*\n', { flag: 'wx' })
    const original = join(backup, 'source')
    let created = false
    let moved = false
    let linked = false
    try {
      await fs.mkdir(dirname(newRoot), { recursive: true })
      if (bundle) await fs.mkdir(newRoot)
      else await fs.writeFile(newRoot, '', { flag: 'wx' })
      created = true
      await fs.cp(oldRoot, newRoot, { recursive: true, verbatimSymlinks: true })
      if (bundle) await relocateAssetLinks(root, oldRoot, newRoot)
      await fs.writeFile(newReadme, serializeWikiPage(frontmatter, body))
      if (
        (await fs.stat(oldReadme)).mtimeMs !== sourceMtime ||
        (await snapshot(root, oldRoot)) !== sourceHash
      )
        throw new Error('CONFLICT: Report changed during conversion')
      await fs.writeFile(
        join(backup, 'manifest.json'),
        `${JSON.stringify(
          {
            ...plan,
            created_at: formatIsoLocal(new Date()),
          },
          null,
          2,
        )}\n`,
      )
      await fs.rename(oldRoot, original)
      moved = true
      await fs.symlink(relative(dirname(oldRoot), newRoot), oldRoot)
      linked = true
      return { ...plan, applied: true, backup: relative(root, backup), oldPathAlias: true }
    } catch (error) {
      if (linked) await fs.unlink(oldRoot)
      if (moved) await fs.rename(original, oldRoot)
      if (created) await fs.rm(newRoot, { recursive: true, force: true })
      throw error
    }
  }
  return options.apply ? withFileWriterLock(root, work) : work()
}

async function main() {
  const options = argumentsFor(
    {
      report: { type: 'string' },
      kind: { type: 'string' },
      slug: { type: 'string' },
      status: { type: 'string' },
      'created-at': { type: 'string' },
      'expected-hash': { type: 'string' },
      apply: { type: 'boolean' },
    },
    'node reports-to-wiki.mjs --project-root PROJECT --report R0001 --kind note [--created-at ISO] [--expected-hash HASH] [--apply]',
  )
  if (!options) return
  const result = await migrateReport(options)
  if (result.applied) {
    const index = await rebuildIndex(options['project-root'], { role: 'cli' })
    if (index.status !== 'rebuilt')
      throw new Error('Migration applied; run memon refresh to repair inventory')
  }
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
}

runScript(import.meta.url, main)
