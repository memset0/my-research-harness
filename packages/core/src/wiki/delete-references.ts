import { basename, dirname, isAbsolute, resolve, sep } from 'node:path'
import { parse as parseHtml } from 'parse5'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import remarkParse from 'remark-parse'
import { unified } from 'unified'
import { isAlias, isMap, isScalar, isSeq, parseDocument } from 'yaml'
import { derivePayload } from '../components/payload.js'
import { COMPONENT_LATEST_VERSION, COMPONENT_TYPES } from './component-names.generated.js'
import { parseWikiComponentBlocks } from './components.js'
import { extractWikiReferences, resolvesWikiReference } from './lint.js'

export interface WikiDeleteReference {
  source: string
  line: number
  column?: number
  field?: string
  reference: string
  /** A matching address whose deployment identity cannot be established locally. */
  ambiguous?: string
}

export interface WikiDeleteTarget {
  projectRoot: string
  projectName: string
  projectNames?: string[]
  otherProjectNames?: string[]
  /** undefined means unknown; null identifies an explicitly local project. */
  host?: string | null
  origins?: string[]
  /** Existing Reports take precedence over a Wiki's legacy_id. */
  reportIds?: string[]
  id: string
  slug: string
  legacyId?: string
  ownedPaths: string[]
}

interface MarkdownNode {
  type: string
  value?: string
  url?: string
  identifier?: string
  children?: MarkdownNode[]
  position?: { start: { line: number; column: number; offset?: number } }
}
interface HtmlNode {
  nodeName: string
  tagName?: string
  value?: string
  attrs?: Array<{ name: string; value: string; prefix?: string }>
  childNodes?: HtmlNode[]
  content?: HtmlNode
  sourceCodeLocation?: {
    startOffset: number
    attrs?: Record<string, { startOffset: number }>
  }
}

type Match = false | true | string
const markdown = unified().use(remarkParse).use(remarkGfm).use(remarkMath)
const within = (root: string, path: string) => path === root || path.startsWith(`${root}${sep}`)
const voidElements = new Set([
  'area',
  'base',
  'br',
  'col',
  'embed',
  'hr',
  'img',
  'input',
  'link',
  'meta',
  'param',
  'source',
  'track',
  'wbr',
])
const proseFields = /(?:^|\.)(?:body|markdown|content|notes|description|reason)$/
const identityFields = /(?:^|\.)(?:sources?|refs?|references?|superseded_by)(?:\[|$)/

function identity(raw: string, target: WikiDeleteTarget): boolean {
  const ref = raw.replace(/^@/, '').split(/[?#]/, 1)[0]!
  if (ref === target.legacyId && target.reportIds?.includes(ref)) return false
  return resolvesWikiReference(ref, {
    wikiIds: [target.id],
    wikiSlugs: [target.slug],
    wikiLegacyIds: target.legacyId ? [target.legacyId] : [],
    experimentIds: [],
    runIds: [],
    hypothesisIds: [],
  })
}

function deploymentScope(
  project: string | null,
  host: string | null,
  origin: string | null,
  target: WikiDeleteTarget,
): Match {
  const names = new Set([target.projectName, ...(target.projectNames ?? [])])
  if (project && target.otherProjectNames?.includes(project) && !names.has(project)) return false
  if (target.host !== undefined && host !== target.host) return false
  if (origin && target.origins?.length && !target.origins.includes(origin)) return false
  const unknown: string[] = []
  if (!project || !names.has(project)) unknown.push(`project ${project ?? '(not declared)'}`)
  if (target.host === undefined) unknown.push(`host ${host ?? '(local default)'}`)
  if (origin && !target.origins?.length) unknown.push(`origin ${origin}`)
  return unknown.length
    ? `Cannot establish ${unknown.join(', ')} as this project; use a project-relative file reference or provide the deployment mapping`
    : true
}

function decodePath(path: string): string | null {
  try {
    const parts = path.split('/').map(decodeURIComponent)
    if (parts.some((part) => /[\\\0/]/.test(part))) return null
    return parts.join('/')
  } catch {
    return null
  }
}

function pointsAtTarget(
  raw: string,
  source: string,
  target: WikiDeleteTarget,
  options: { logical?: boolean; base?: string; workspace?: boolean } = {},
): Match {
  const ref = raw.trim()
  if (!ref || ref.startsWith('#') || /^(?:data|mailto|javascript|tel):/i.test(ref)) return false
  if ((ref.startsWith('@') && options.workspace) || options.logical) {
    if (identity(ref, target)) return true
    if (ref.startsWith('@')) return false
  }
  if (ref.startsWith('?'))
    return options.workspace === true && new URLSearchParams(ref.slice(1)).get('wiki') === target.id
  let url: URL
  try {
    url = new URL(ref, options.base ?? 'http://local.invalid')
  } catch {
    return false
  }
  const decoded = decodePath(url.pathname)
  if (decoded === null) return false
  const parts = decoded.split('/').filter(Boolean)
  const origin =
    url.origin === 'http://local.invalid' || url.protocol === 'file:' ? null : url.origin
  const p = parts[0] === 'p' ? 0 : parts[0] === 'h' && parts[2] === 'p' ? 2 : -1
  if (p >= 0) {
    const collection = parts[p + 2],
      id = parts[p + 3]
    const full = parts.length === p + 4
    const isWikiPage = full && collection === 'wiki'
    const legacyReport =
      full &&
      collection === 'reports' &&
      id !== undefined &&
      /^R\d{4}$/.test(id) &&
      id === target.legacyId &&
      identity(id, target)
    const addressed =
      (isWikiPage && (id === target.id || id === target.slug)) ||
      legacyReport ||
      (!isWikiPage && collection !== 'wiki' && url.searchParams.get('wiki') === target.id)
    return addressed
      ? deploymentScope(parts[p + 1] ?? null, p === 2 ? parts[1]! : null, origin, target)
      : false
  }
  if (parts[0] === 'api') {
    let addressed = false,
      project: string | null = null
    if (
      ['content-assets', 'content-services', 'content-health'].includes(parts[1] ?? '') &&
      parts.length >= 6
    ) {
      if (parts[4] !== 'wiki' || parts[5] !== target.id) return false
      return deploymentScope(parts[3]!, parts[2] === '-' ? null : parts[2]!, origin, target)
    }
    if (parts[1] === 'wiki-assets' && parts.length >= 4) {
      project = parts[2]!
      addressed = parts[3] === target.id || parts[3] === target.slug
    } else if (parts[1] === 'doc-assets' && parts.length >= 4) {
      project = parts[2]!
      const path = resolve(target.projectRoot, ...parts.slice(3))
      addressed = target.ownedPaths.some((owned) => within(owned, path))
    } else if (parts[1] === 'wiki' && parts.length === 3) {
      project = url.searchParams.get('project')
      addressed = parts[2] === target.id
    }
    if (addressed) return deploymentScope(project, url.searchParams.get('host'), origin, target)
  }
  if (
    url.protocol !== 'file:' &&
    (/^[a-z][a-z0-9+.-]*:/i.test(ref) || ref.startsWith('//') || origin)
  )
    return false
  const path = decodePath(ref.split(/[?#]/, 1)[0]!)
  if (path === null) return false
  const candidates = options.base
    ? [url.protocol === 'file:' ? decoded : resolve(target.projectRoot, `.${decoded}`)]
    : [resolve(dirname(resolve(target.projectRoot, source)), path)]
  if (path.startsWith('/docs/')) candidates.push(resolve(target.projectRoot, `.${path}`))
  if (path.startsWith('docs/')) candidates.push(resolve(target.projectRoot, path))
  if (isAbsolute(path)) candidates.push(resolve(path))
  if (candidates.some((candidate) => target.ownedPaths.some((owned) => within(owned, candidate))))
    return true
  // Legacy Report document paths fall back to Wiki only after that Report is gone.
  if (target.legacyId && identity(target.legacyId, target)) {
    const reports = resolve(target.projectRoot, 'docs/reports')
    return candidates.some(
      (candidate) =>
        within(reports, candidate) &&
        new RegExp(`(?:^|/)${target.legacyId}-[a-z0-9-]+(?:\\.md|/README\\.md)$`).test(candidate),
    )
  }
  return false
}

/** Scan static document references. No scripts, components or monitors are executed. */
export function wikiDeleteReferences(
  content: string,
  source: string,
  target: WikiDeleteTarget,
): WikiDeleteReference[] {
  const result: WikiDeleteReference[] = []
  const sourcePath = resolve(target.projectRoot, source)
  if (target.ownedPaths.some((owned) => within(owned, sourcePath))) return result
  function add(
    reference: string,
    at: number,
    field?: string,
    options?: Parameters<typeof pointsAtTarget>[3],
  ) {
    const match = pointsAtTarget(reference, source, target, options)
    if (!match) return
    const prefix = content.slice(0, Math.max(0, at))
    result.push({
      source,
      line: prefix.split('\n').length,
      column: prefix.length - prefix.lastIndexOf('\n'),
      ...(field ? { field } : {}),
      reference,
      ...(typeof match === 'string' ? { ambiguous: match } : {}),
    })
  }
  function scanCss(text: string, offset: number, field?: string, base?: string) {
    const clean = text.replace(/\/\*[\s\S]*?\*\//g, (s) => s.replace(/[^\n]/g, ' '))
    const pattern =
      /(?<![\w-])url\(\s*(?:"((?:\\[\s\S]|[^"\\])*)"|'((?:\\[\s\S]|[^'\\])*)'|((?:\\[\s\S]|[^)\\])*?))\s*\)|@import\s+(?:"((?:\\[\s\S]|[^"\\])*)"|'((?:\\[\s\S]|[^'\\])*)')|"(?:\\[\s\S]|[^"\\])*"|'(?:\\[\s\S]|[^'\\])*'/gi
    for (const match of clean.matchAll(pattern)) {
      if (match.slice(1).every((part) => part === undefined)) continue
      const value = (match[1] ?? match[2] ?? match[3] ?? match[4] ?? match[5] ?? '')
        .trim()
        .replace(
          /\\([0-9a-f]{1,6})(?:\r\n|[\t\n\f\r ])?|\\(?:\r\n|[\n\r\f])|\\(.)/gi,
          (_, hex, escaped) =>
            hex
              ? String.fromCodePoint(Math.min(Number.parseInt(hex, 16), 0x10ffff) || 0xfffd)
              : (escaped ?? ''),
        )
      add(value, offset + match.index!, field ?? 'url', { base })
    }
  }
  function scanHtml(text: string, offset: number, field?: string) {
    const tree = parseHtml(text, { sourceCodeLocationInfo: true }) as unknown as HtmlNode
    let base: string | undefined
    function findBase(node: HtmlNode) {
      if (!base && node.tagName === 'base') {
        const href = node.attrs?.find((attr) => attr.name === 'href')?.value
        if (href) {
          try {
            base = new URL(href, `file://${sourcePath}`).href
          } catch {}
        }
      }
      node.childNodes?.forEach(findBase)
    }
    findBase(tree)
    function visit(node: HtmlNode) {
      for (const attr of node.attrs ?? []) {
        const name = attr.prefix ? `${attr.prefix}:${attr.name}` : attr.name
        const at =
          offset +
          (node.sourceCodeLocation?.attrs?.[name]?.startOffset ??
            node.sourceCodeLocation?.startOffset ??
            0)
        const key = field ? `${field}.${name}` : name
        if (name === 'style') scanCss(attr.value, at, key, base)
        else if (name === 'srcdoc') scanHtml(attr.value, at, key)
        else if (
          [
            'href',
            'xlink:href',
            'src',
            'poster',
            'action',
            'formaction',
            'data',
            'srcset',
          ].includes(name)
        ) {
          const refs =
            name === 'srcset'
              ? attr.value.split(',').map((part) => part.trim().split(/\s+/)[0]!)
              : [attr.value]
          for (const ref of refs)
            add(ref, at, key, { base: node.tagName === 'base' ? undefined : base })
        }
      }
      if (node.tagName === 'style') {
        for (const child of node.childNodes ?? [])
          scanCss(
            child.value ?? '',
            offset + (child.sourceCodeLocation?.startOffset ?? 0),
            field,
            base,
          )
      }
      // src is inspected above; arbitrary executable JavaScript is not analyzed.
      if (node.tagName !== 'script') node.childNodes?.forEach(visit)
      if (node.content) visit(node.content)
    }
    visit(tree)
  }
  function scanMetadata(text: string, offset: number, fieldPrefix = '') {
    const doc = parseDocument(text, { uniqueKeys: true })
    if (doc.errors.length)
      throw new Error(`${source}: unreadable metadata: ${doc.errors[0]!.message}`)
    let nodes = 0
    const active = new Set<unknown>()
    function walk(node: unknown, field: string, aliasAt?: number): void {
      if (!node || typeof node !== 'object') return
      if (++nodes > 100_000 || active.has(node))
        throw new Error(`${source}: cyclic or excessive metadata aliases at ${field}`)
      active.add(node)
      const at = aliasAt ?? offset + ((node as { range?: number[] }).range?.[0] ?? 0)
      if (isAlias(node)) walk(node.resolve(doc), field, at)
      else if (isScalar(node) && typeof node.value === 'string') {
        const value = node.value
        add(value, at, field, { logical: identityFields.test(field) })
        // Stored prose/HTML is rendered content, unlike a script/code payload.
        if (proseFields.test(field)) scanMarkdown(value, at, field, true)
        if (/(?:^|\.)(?:data|html)$/.test(field) && /<[a-z][\s\S]*>/i.test(value))
          scanHtml(value, at, field)
      } else if (isMap(node)) {
        for (const pair of node.items) {
          const key = isScalar(pair.key) ? String(pair.key.value) : String(pair.key)
          walk(pair.value, field ? `${field}.${key}` : key, aliasAt)
        }
      } else if (isSeq(node)) {
        node.items.forEach((child, i) => {
          walk(child, `${field}[${i}]`, aliasAt)
        })
      }
      active.delete(node)
    }
    walk(doc.contents, fieldPrefix)
  }
  function scanMarkdown(text: string, offset: number, field?: string, stored = false) {
    const tree = markdown.parse(text) as MarkdownNode
    const definitions = new Map<string, string>()
    function gather(node: MarkdownNode) {
      if (
        node.type === 'definition' &&
        node.identifier &&
        node.url &&
        !definitions.has(node.identifier.toLowerCase())
      )
        definitions.set(node.identifier.toLowerCase(), node.url)
      node.children?.forEach(gather)
    }
    gather(tree)
    const position = (node: MarkdownNode, delta = 0) =>
      stored ? offset : offset + (node.position?.start.offset ?? 0) + delta
    function visit(node: MarkdownNode) {
      if (['code', 'inlineCode', 'math', 'inlineMath', 'definition'].includes(node.type)) return
      if (node.type === 'link' || node.type === 'image') {
        if (node.url) add(node.url, position(node), field, { workspace: true })
        return
      }
      if (node.type === 'linkReference' || node.type === 'imageReference') {
        const ref = definitions.get(node.identifier?.toLowerCase() ?? '')
        if (ref) add(ref, position(node), field, { workspace: true })
        return
      }
      if (node.type === 'html') {
        scanHtml(node.value ?? '', position(node), field)
        return
      }
      if (node.type === 'text') {
        const value = node.value ?? ''
        let cursor = 0
        for (const ref of extractWikiReferences(value, value)) {
          const index = value.indexOf(`@${ref.ref}`, cursor)
          if (index < 0) continue
          cursor = index + ref.ref.length + 1
          add(`@${ref.ref}`, position(node, index), field, { logical: true })
        }
        for (const match of value.matchAll(/[WR]\d{4}/g)) {
          const index = match.index!,
            end = index + match[0].length
          if (
            /[A-Za-z0-9_@-]/.test(value[index - 1] ?? '') ||
            /[A-Za-z0-9_-]/.test(value[end] ?? '')
          )
            continue
          add(match[0], position(node, index), field, { logical: true })
        }
      }
      let htmlDepth = 0
      for (const child of node.children ?? []) {
        if (child.type === 'html') {
          visit(child)
          for (const tag of (child.value ?? '').matchAll(
            /<(\/)?([A-Za-z][A-Za-z0-9:-]*)(?:\s[^<>]*?)?(\/?)>/g,
          )) {
            if (tag[1]) htmlDepth = Math.max(0, htmlDepth - 1)
            else if (!tag[3] && !voidElements.has(tag[2]!.toLowerCase())) htmlDepth++
          }
        } else if (!htmlDepth) visit(child)
      }
    }
    visit(tree)
    for (const block of parseWikiComponentBlocks(text)) {
      if (!COMPONENT_TYPES.some((type) => type === block.type)) continue
      const latest = COMPONENT_LATEST_VERSION[block.type as keyof typeof COMPONENT_LATEST_VERSION]
      if (block.version !== null && block.version !== latest) continue
      if (derivePayload(block.lang, block.payload).kind === 'error') continue
      const begin = text.split('\n').slice(0, block.line).join('\n').length + 1
      if (block.lang === 'html') scanHtml(block.payload, stored ? offset : offset + begin, field)
      if (block.lang === 'yaml' || block.lang === 'json')
        scanMetadata(block.payload, stored ? offset : offset + begin, field)
    }
  }
  if (/\.json$/i.test(source)) {
    try {
      JSON.parse(content)
    } catch {
      throw new Error(`${source}: unreadable JSON metadata`)
    }
    scanMetadata(content, 0)
  } else if (/\.ya?ml$/i.test(source)) scanMetadata(content, 0)
  else if (/\.(?:html?|svg)$/i.test(source)) scanHtml(content, 0)
  else if (/\.css$/i.test(source)) scanCss(content, 0)
  else {
    const fm = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(content)
    if (fm) scanMetadata(fm[1]!, fm[0].indexOf(fm[1]!))
    scanMarkdown(fm ? content.slice(fm[0].length) : content, fm?.[0].length ?? 0)
  }
  const unique = new Map(
    result.map((item) => [
      `${item.line}:${item.column}:${item.field ?? ''}:${item.reference}`,
      item,
    ]),
  )
  return [...unique.values()].sort((a, b) => a.line - b.line || (a.column ?? 0) - (b.column ?? 0))
}

export function wikiDeleteProjectName(root: string): string {
  return basename(root)
}
