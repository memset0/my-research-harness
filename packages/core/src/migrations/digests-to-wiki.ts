import { promises as fs } from 'node:fs'
import { createHash, randomUUID } from 'node:crypto'
import { dirname, join, posix } from 'node:path'
import { unified } from 'unified'
import remarkParse from 'remark-parse'
import { parseWikiFrontmatter, serializeWikiPage } from '../wiki/frontmatter.js'
import type { WikiFrontmatter } from '../wiki/types.js'
import { formatIsoLocal } from '../time.js'

export interface DigestWikiMigrationPlan {
  version: 1
  root: string
  documents: Array<{ source: string; target: string; before: string; after: string; hash: string }>
  wikiInventory: Array<{ path: string; hash: string }>
  blockers: string[]
}

const fingerprint = (content: string) => createHash('sha256').update(content).digest('hex')
const canonicalDigest = /^D(\d{4})-(\d{4}-\d{2}-\d{2})\.md$/

async function checkedPath(root: string, path: string): Promise<string> {
  if (
    !path ||
    path.includes('\\') ||
    path.startsWith('/') ||
    path.split('/').some((part) => !part || part === '.' || part === '..')
  )
    throw new Error(`Unsafe migration path: ${path}`)
  let current = root
  for (const part of path.split('/')) {
    current = join(current, part)
    try {
      if ((await fs.lstat(current)).isSymbolicLink()) throw new Error(`Unsafe symlink: ${path}`)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
  }
  return current
}

async function readOptional(root: string, path: string): Promise<string | null> {
  try {
    const bytes = await fs.readFile(await checkedPath(root, path))
    const text = bytes.toString('utf8')
    if (!Buffer.from(text).equals(bytes)) throw new Error(`Not UTF-8: ${path}`)
    return text
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw error
  }
}

async function wikiInventory(root: string): Promise<Array<{ path: string; hash: string }>> {
  const result: Array<{ path: string; hash: string }> = []
  const directory = await checkedPath(root, 'docs/wiki')
  const kinds = await fs
    .readdir(directory, { withFileTypes: true })
    .catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return []
      throw error
    })
  for (const kind of kinds) {
    if (kind.isSymbolicLink()) throw new Error(`Unsafe Wiki symlink: ${kind.name}`)
    if (!kind.isDirectory() || kind.name === 'assets') continue
    const entries = await fs.readdir(join(directory, kind.name), { withFileTypes: true })
    for (const entry of entries) {
      if (!/^W\d{4}-/.test(entry.name)) continue
      if (entry.isSymbolicLink()) throw new Error(`Unsafe Wiki symlink: ${entry.name}`)
      const path = `docs/wiki/${kind.name}/${entry.name}${entry.isDirectory() ? '/README.md' : ''}`
      const content = await readOptional(root, path)
      if (content === null) throw new Error(`Missing Wiki README: ${path}`)
      result.push({ path, hash: fingerprint(content) })
    }
  }
  return result.sort((left, right) => left.path.localeCompare(right.path, 'en'))
}

function rebaseLinks(
  body: string,
  source: string,
  target: string,
  destinations: Map<string, string>,
): string {
  const tree = unified().use(remarkParse).parse(body)
  const imageReferences = new Set<string>()
  const collectImages = (node: { type: string; identifier?: string; children?: unknown[] }) => {
    if (node.type === 'imageReference' && node.identifier) imageReferences.add(node.identifier)
    for (const child of node.children ?? [])
      collectImages(child as Parameters<typeof collectImages>[0])
  }
  collectImages(tree)
  const edits: Array<{ start: number; end: number; text: string }> = []
  const visit = (node: {
    type: string
    identifier?: string
    url?: string
    value?: string
    children?: unknown[]
    position?: { start: { offset?: number }; end: { offset?: number } }
  }) => {
    if (node.type === 'html') {
      for (const attribute of (node.value ?? '').matchAll(
        /\b(src|href|srcset)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi,
      )) {
        const value = attribute[2] ?? attribute[3] ?? attribute[4] ?? ''
        if (
          attribute[1]!.toLowerCase() === 'srcset' ||
          (value && !/^(?:[a-z][a-z\d+.-]*:|\/|#)/i.test(value))
        )
          throw new Error('Relative HTML assets require explicit conversion before migration')
      }
    }
    if (node.url && !/^(?:[a-z][a-z\d+.-]*:|\/|#|\?)/i.test(node.url)) {
      if (
        node.type === 'image' ||
        (node.type === 'definition' && imageReferences.has(node.identifier ?? ''))
      )
        throw new Error('Relative image assets require a Wiki bundle or figure before migration')
      const match = /^([^?#]*)([?#].*)?$/.exec(node.url)!
      const decoded = decodeURIComponent(match[1]!)
      if (decoded.includes('\\')) throw new Error('Unsafe relative link')
      const original = posix.normalize(posix.join(posix.dirname(source), decoded))
      if (original === '..' || original.startsWith('../'))
        throw new Error('Relative link escapes project')
      const destination = destinations.get(original) ?? original
      const url =
        posix
          .relative(posix.dirname(target), destination)
          .split('/')
          .map((part) => encodeURIComponent(part))
          .join('/') + (match[2] ?? '')
      const start = node.position?.start.offset
      const end = node.position?.end.offset
      if (start === undefined || end === undefined) throw new Error('Cannot locate Markdown link')
      const raw = body.slice(start, end)
      const opening = node.type === 'definition' ? raw.indexOf(':') + 1 : raw.lastIndexOf('](') + 2
      const offset = raw.indexOf(node.url, opening)
      if (opening < 1 || offset < 0)
        throw new Error('Escaped Markdown destination requires explicit conversion')
      edits.push({ start: start + offset, end: start + offset + node.url.length, text: url })
    }
    for (const child of node.children ?? []) visit(child as Parameters<typeof visit>[0])
  }
  visit(tree)
  let result = body
  for (const edit of edits.sort((left, right) => right.start - left.start))
    result = result.slice(0, edit.start) + edit.text + result.slice(edit.end)
  return result
}

export async function planDigestWikiMigration(
  projectRoot: string,
): Promise<DigestWikiMigrationPlan> {
  const root = await fs.realpath(projectRoot)
  const plan: DigestWikiMigrationPlan = {
    version: 1,
    root,
    documents: [],
    wikiInventory: [],
    blockers: [],
  }
  try {
    const directory = await checkedPath(root, 'docs/digests')
    const entries = await fs
      .readdir(directory, { withFileTypes: true })
      .catch((error: NodeJS.ErrnoException) => {
        if (error.code === 'ENOENT') return []
        throw error
      })
    if (!entries.length) return plan
    plan.wikiInventory = await wikiInventory(root)
    const ids = plan.wikiInventory.map((entry) => /\/(W\d{4})-/.exec(entry.path)![1]!)
    if (new Set(ids).size !== ids.length) throw new Error('Duplicate existing Wiki identities')
    let next = Math.max(0, ...ids.map((id) => Number(id.slice(1)))) + 1
    const legacyIds = new Set<string>()
    for (const entry of plan.wikiInventory) {
      const content = (await readOptional(root, entry.path))!
      const legacy = parseWikiFrontmatter(content).frontmatter?.legacy_id
      if (typeof legacy === 'string') legacyIds.add(legacy)
    }
    const destinations = new Map<string, string>()
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name, 'en'))) {
      const match = canonicalDigest.exec(entry.name)
      if (!entry.isFile() || !match)
        throw new Error(`Unrecognized legacy Digest entry requires review: ${entry.name}`)
      const id = `D${match[1]}`
      if (legacyIds.has(id)) throw new Error(`Duplicate legacy identity: ${id}`)
      legacyIds.add(id)
      if (next > 9999) throw new Error('Wiki identity space exhausted')
      destinations.set(
        `docs/digests/${entry.name}`,
        `docs/wiki/digest/W${String(next++).padStart(4, '0')}-digest-${id.toLowerCase()}-${match[2]}.md`,
      )
    }
    for (const [source, target] of destinations) {
      const before = (await readOptional(root, source))!
      const parsed = parseWikiFrontmatter(before)
      if (/^\uFEFF?---/.test(before) && !parsed.frontmatter)
        throw new Error(`Malformed frontmatter: ${source}`)
      const previous: Partial<WikiFrontmatter> = parsed.frontmatter ?? {}
      const match = canonicalDigest.exec(posix.basename(source))!
      const id = `D${match[1]}`
      if (previous.id !== undefined && previous.id !== id)
        throw new Error(`Legacy identity mismatch: ${source}`)
      if (previous.legacy_id !== undefined && previous.legacy_id !== id)
        throw new Error(`Conflicting legacy_id: ${source}`)
      const timestamp = formatIsoLocal((await fs.stat(join(root, source))).mtime)
      const header = {
        ...previous,
        id: /\/(W\d{4})-/.exec(target)![1],
        kind: 'digest',
        legacy_id: id,
        title: previous.title ?? /^#\s+(.+)$/m.exec(parsed.body)?.[1] ?? `Digest ${match[2]}`,
        date: previous.date ?? match[2],
        created_at: previous.created_at ?? timestamp,
        updated_at: previous.updated_at ?? timestamp,
      } as WikiFrontmatter
      const after = serializeWikiPage(
        header,
        rebaseLinks(parsed.body, source, target, destinations),
      )
      plan.documents.push({ source, target, before, after, hash: fingerprint(before) })
    }
  } catch (error) {
    plan.blockers.push((error as Error).message)
  }
  return plan
}

export async function validateDigestWikiMigration(plan: DigestWikiMigrationPlan): Promise<void> {
  if (plan.version !== 1 || plan.blockers.length)
    throw new Error('Digest migration plan has blockers')
  const root = await fs.realpath(plan.root)
  const seen = new Set<string>()
  for (const document of plan.documents) {
    if (
      !/^docs\/digests\/D\d{4}-\d{4}-\d{2}-\d{2}\.md$/.test(document.source) ||
      !/^docs\/wiki\/digest\/W\d{4}-[a-z\d-]+\.md$/.test(document.target)
    )
      throw new Error('Invalid Digest migration scope')
    if (seen.has(document.source) || seen.has(document.target))
      throw new Error('Duplicate Digest migration path')
    seen.add(document.source)
    seen.add(document.target)
    if (fingerprint(document.before) !== document.hash) throw new Error('Corrupt Digest preimage')
    if (
      (await readOptional(root, document.source)) !== document.before ||
      (await readOptional(root, document.target)) !== null
    )
      throw new Error(`Stale Digest migration plan: ${document.source}`)
  }
  const current = await planDigestWikiMigration(root)
  if (
    current.blockers.length ||
    JSON.stringify(current.wikiInventory) !== JSON.stringify(plan.wikiInventory) ||
    JSON.stringify(current.documents) !== JSON.stringify(plan.documents)
  )
    throw new Error('Stale Digest migration inventory')
}

export async function applyDigestWikiMigration(plan: DigestWikiMigrationPlan): Promise<void> {
  await validateDigestWikiMigration(plan)
  const root = await fs.realpath(plan.root)
  try {
    for (const document of plan.documents) {
      const target = await checkedPath(root, document.target)
      await fs.mkdir(dirname(target), { recursive: true })
      await checkedPath(root, document.target)
      await fs.writeFile(target, document.after, {
        flag: 'wx',
        mode: (await fs.stat(join(root, document.source))).mode,
      })
      if (
        (await readOptional(root, document.target)) !== document.after ||
        (await readOptional(root, document.source)) !== document.before
      )
        throw new Error('Concurrent Digest edit')
      await fs.unlink(await checkedPath(root, document.source))
    }
  } catch (error) {
    await rollbackDigestWikiMigration(plan)
    throw error
  }
}

export async function verifyDigestWikiMigration(plan: DigestWikiMigrationPlan): Promise<void> {
  if (!plan.documents.length) return
  const root = await fs.realpath(plan.root)
  const expected = [
    ...plan.wikiInventory,
    ...plan.documents.map((document) => ({
      path: document.target,
      hash: fingerprint(document.after),
    })),
  ].sort((left, right) => left.path.localeCompare(right.path))
  const current = (await wikiInventory(root)).sort((left, right) =>
    left.path.localeCompare(right.path),
  )
  if (JSON.stringify(current) !== JSON.stringify(expected))
    throw new Error('Concurrent Wiki inventory edit')
  for (const document of plan.documents) {
    if ((await readOptional(root, document.source)) !== null)
      throw new Error('Legacy Digest remains after migration')
  }
}

export async function rollbackDigestWikiMigration(
  plan: DigestWikiMigrationPlan,
  checkOnly = false,
): Promise<void> {
  if (plan.version !== 1 || plan.blockers.length) throw new Error('Invalid Digest recovery plan')
  const root = await fs.realpath(plan.root)
  for (const document of plan.documents) {
    if (
      !/^docs\/digests\/D\d{4}-\d{4}-\d{2}-\d{2}\.md$/.test(document.source) ||
      !/^docs\/wiki\/digest\/W\d{4}-[a-z\d-]+\.md$/.test(document.target)
    )
      throw new Error('Invalid Digest recovery scope')
    if (fingerprint(document.before) !== document.hash) throw new Error('Corrupt Digest preimage')
    const source = await readOptional(root, document.source)
    const target = await readOptional(root, document.target)
    if (
      (source !== null && source !== document.before) ||
      (target !== null && target !== document.after) ||
      (source === null && target === null)
    )
      throw new Error('Concurrent edit blocks Digest rollback')
  }
  if (checkOnly) return
  for (const document of [...plan.documents].reverse()) {
    const source = await checkedPath(root, document.source)
    if ((await readOptional(root, document.source)) === null) {
      const target = await checkedPath(root, document.target)
      const temp = join(dirname(source), `.memon-digest-${randomUUID()}`)
      await fs.mkdir(dirname(source), { recursive: true })
      try {
        await fs.writeFile(temp, document.before, {
          flag: 'wx',
          mode: (await fs.stat(target)).mode,
        })
        await fs.link(temp, source)
      } finally {
        await fs.rm(temp, { force: true })
      }
    }
    if ((await readOptional(root, document.target)) === document.after)
      await fs.unlink(await checkedPath(root, document.target))
  }
}
