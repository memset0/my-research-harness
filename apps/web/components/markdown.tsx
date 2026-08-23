'use client'

import {
  Children,
  cloneElement,
  createContext,
  isValidElement,
  type ReactElement,
  type ReactNode,
  useContext,
  useMemo,
} from 'react'
import Link from 'next/link'
import ReactMarkdown, { type Components } from 'react-markdown'
import rehypeKatex from 'rehype-katex'
import rehypeRaw from 'rehype-raw'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import 'katex/dist/katex.min.css'
import {
  type ArtifactInventory,
  type ArtifactTarget,
  resolveArtifactMarkdownHref,
  resolveBareArtifactReference,
} from '../lib/artifact-links'
import type { ArtifactSourceSurface } from '../lib/report-workspace-url'
import { cn } from '../lib/utils'
import { replaceWorkspaceHistory } from '../lib/workspace-history'
import { GithubPermalinkPreview, isGithubBlobPermalink } from './github-permalink-preview'
import { ReportHtmlEmbed } from './report-html-embed'

export type MarkdownArtifactSourceSurface = ArtifactSourceSurface

export interface MarkdownArtifactLinkContext {
  inventory: ArtifactInventory
  /** Absolute source Markdown path returned by the Experiment/Report API. */
  sourceDocumentPath: string
  sourceSurface: MarkdownArtifactSourceSurface
  /** Surface-aware wrapper around `buildArtifactNavigationHref`. */
  getArtifactHref: (
    target: ArtifactTarget,
    sourceSurface: MarkdownArtifactSourceSurface,
  ) => string | null
}

export interface MarkdownTableOfContentsOptions {
  /** Keeps Report anchors distinct from headings in the left document. */
  headingIdPrefix: string
  title?: string
  minDepth?: number
  maxDepth?: number
}

const ArtifactLinkContext = createContext<MarkdownArtifactLinkContext | null>(null)

/**
 * Lets an Experiment or Report surface enable artifact links for all nested
 * Markdown fields (including structured Experiment RichText) without making
 * artifact recognition global to unrelated project documents.
 */
export function MarkdownArtifactLinkProvider({
  value,
  children,
}: {
  value: MarkdownArtifactLinkContext
  children: ReactNode
}) {
  return <ArtifactLinkContext.Provider value={value}>{children}</ArtifactLinkContext.Provider>
}

// Force every `<input type="checkbox">` produced by remark-gfm's task-list
// plugin to be `disabled`. v1 of the experiment doc Plan section is
// read-only; toggling happens via the Edit markdown dialog. This override
// guards against future remark-gfm versions that might emit interactive
// checkboxes by default.
const BASE_COMPONENTS: Components = {
  input: ({ node: _node, type, checked, ...rest }) => {
    if (type === 'checkbox') {
      return (
        <input
          type="checkbox"
          checked={!!checked}
          disabled
          readOnly
          aria-readonly="true"
          {...rest}
        />
      )
    }
    return <input type={type} {...rest} />
  },
  // Wrap every GFM <table> in a horizontally-scrollable container so a
  // wide table can scroll inside its parent Card (which carries
  // `overflow-hidden` for chrome) instead of being clipped at the right
  // edge. `min-w-0` on the <Markdown> root is what lets this engage in
  // a flex/grid ancestor — see the wrapper className below.
  table: ({ node: _node, ...rest }) => (
    <div className="my-4 w-full overflow-x-auto">
      <table {...rest} />
    </div>
  ),
}

export function Markdown({
  children,
  className,
  project,
  resourceBaseUrl,
  artifactLinks,
  tableOfContents,
}: {
  children: string
  className?: string
  // When set, GitHub blob line-permalinks in the body become hover-preview
  // links (code is fetched from the project's mapped LOCAL repo). Omit it
  // and links render as plain external anchors. Threaded from every page
  // that knows which project the markdown belongs to.
  project?: string
  /**
   * Base endpoint for relative assets in a directory-style Report. Markdown
   * images are rewritten beneath it; an image whose target ends in .html or
   * .htm becomes a same-origin iframe. Intentionally no `sandbox` attribute:
   * report HTML is trusted Agent-authored content in the v1 trust model.
   */
  resourceBaseUrl?: string
  /** Explicit value overrides the nearest provider; null explicitly disables it. */
  artifactLinks?: MarkdownArtifactLinkContext | null
  /** Prepends an accessible heading outline and anchors the matching headings. */
  tableOfContents?: MarkdownTableOfContentsOptions
}) {
  const inheritedArtifactLinks = useContext(ArtifactLinkContext)
  const activeArtifactLinks = artifactLinks === undefined ? inheritedArtifactLinks : artifactLinks
  const components = useMemo<Components>(
    () => ({
      ...BASE_COMPONENTS,
      p: ({ node, children: paragraphChildren, ...rest }) => {
        // CommonMark represents an image-only line as an image inside a
        // paragraph. An HTML-report image becomes a block-level <figure>,
        // which cannot legally remain under <p> and would otherwise hydrate
        // differently in the browser. Promote only those paragraphs to a div;
        // ordinary paragraphs and images retain the default markup.
        if (containsReportHtmlImage(node, resourceBaseUrl)) {
          return <div {...rest}>{paragraphChildren}</div>
        }
        return <p {...rest}>{paragraphChildren}</p>
      },
      a: ({ node, href, children: linkChildren, ...rest }) => {
        if (project && href && isGithubBlobPermalink(href)) {
          return (
            <GithubPermalinkPreview href={href} project={project}>
              {linkChildren}
            </GithubPermalinkPreview>
          )
        }

        const artifactTarget =
          activeArtifactLinks && href
            ? (generatedArtifactTarget(node, activeArtifactLinks.inventory) ??
              resolveArtifactMarkdownHref(
                href,
                activeArtifactLinks.sourceDocumentPath,
                activeArtifactLinks.inventory,
              ))
            : null
        const artifactHref =
          artifactTarget && activeArtifactLinks
            ? activeArtifactLinks.getArtifactHref(
                { kind: artifactTarget.kind, id: artifactTarget.id },
                activeArtifactLinks.sourceSurface,
              )
            : null
        if (artifactTarget && artifactHref) {
          return (
            <Link
              href={artifactHref}
              scroll={false}
              {...rest}
              onClick={(event) => replaceSamePathArtifactHistory(event, artifactHref)}
              data-memon-artifact-kind={artifactTarget.kind}
              data-memon-artifact-id={artifactTarget.id}
            >
              {decorateArtifactIdentifier(linkChildren, artifactTarget)}
            </Link>
          )
        }

        const resolvedHref =
          href && resourceBaseUrl ? (resolveReportResourceUrl(resourceBaseUrl, href) ?? href) : href
        const external = !!resolvedHref && /^https?:\/\//i.test(resolvedHref)
        return (
          <a
            href={resolvedHref}
            {...(external ? { target: '_blank', rel: 'noreferrer noopener' } : {})}
            {...rest}
          >
            {linkChildren}
          </a>
        )
      },
      img: ({ node: _node, src, alt, title, ...rest }) => {
        const resolvedSrc =
          typeof src === 'string' && resourceBaseUrl
            ? resolveReportResourceUrl(resourceBaseUrl, src)
            : null
        if (resolvedSrc && typeof src === 'string' && isHtmlResource(src)) {
          return (
            <ReportHtmlEmbed src={resolvedSrc} title={alt || title || 'Embedded HTML report'} />
          )
        }
        return <img src={resolvedSrc ?? src} alt={alt ?? ''} title={title} {...rest} />
      },
    }),
    [activeArtifactLinks, project, resourceBaseUrl],
  )

  const artifactRemarkPlugin = useMemo(
    () =>
      activeArtifactLinks
        ? () => (tree: MarkdownAstNode) =>
            transformBareArtifactReferences(tree, activeArtifactLinks)
        : null,
    [activeArtifactLinks],
  )
  const tableOfContentsRemarkPlugin = useMemo(
    () =>
      tableOfContents
        ? () => (tree: MarkdownAstNode) => transformReportTableOfContents(tree, tableOfContents)
        : null,
    [tableOfContents],
  )
  const remarkPlugins = useMemo(
    () => [
      remarkGfm,
      remarkMath,
      ...(artifactRemarkPlugin ? [artifactRemarkPlugin] : []),
      ...(tableOfContentsRemarkPlugin ? [tableOfContentsRemarkPlugin] : []),
    ],
    [artifactRemarkPlugin, tableOfContentsRemarkPlugin],
  )

  return (
    <div
      className={cn(
        // `min-w-0` is load-bearing: it lets this wrapper shrink below its
        // intrinsic content width inside a flex/grid ancestor, which is the
        // only way descendants with `overflow-x-auto` (tables, <pre>, KaTeX
        // display blocks) actually engage their horizontal scrollbar
        // instead of pushing the wrapper past the Card's `overflow-hidden`
        // chrome and getting clipped.
        'min-w-0',
        'prose prose-sm dark:prose-invert max-w-none',
        'prose-code:before:content-none prose-code:after:content-none',
        // Inline <code> as a badge-like chip.
        'prose-code:rounded prose-code:bg-muted prose-code:px-1.5 prose-code:py-0.5',
        'prose-code:font-normal prose-code:text-[0.85em] prose-code:text-foreground',
        // Reset the chip styles for code INSIDE <pre> (fenced blocks). The
        // selector `[&_pre_code]:...` has specificity 0,1,2 — strictly higher
        // than the prose-code utilities above (0,1,0) — so block code keeps
        // its own pre-level background, padding, and font-size.
        '[&_pre_code]:bg-transparent [&_pre_code]:p-0 [&_pre_code]:rounded-none',
        '[&_pre_code]:text-inherit [&_pre_code]:text-[1em]',
        // GFM task list rendering: remove the bullet marker on items that
        // contain a checkbox so the checkbox itself is the leading glyph,
        // and give the disabled checkbox an obvious affordance (cursor +
        // slight opacity) so users learn that toggling goes through Edit
        // markdown. Nested levels inherit the same treatment.
        '[&_li.task-list-item]:list-none',
        '[&_li.task-list-item]:pl-0',
        '[&_li.task-list-item>input[type=checkbox]]:mr-2',
        '[&_li.task-list-item>input[type=checkbox]]:cursor-not-allowed',
        '[&_li.task-list-item>input[type=checkbox]]:opacity-70',
        '[&_ul.contains-task-list]:list-none',
        '[&_ul.contains-task-list]:pl-4',
        // KaTeX display-math safety: give block formulas breathing room
        // matching `prose-sm` paragraph rhythm, and allow horizontal
        // scroll so wide formulas don't blow out the panel width on
        // narrow viewports.
        '[&_.katex-display]:my-4',
        '[&_.katex-display]:overflow-x-auto',
        // Long fenced-code lines (e.g., a single-line shell command)
        // must scroll horizontally inside their own <pre> rather than
        // being clipped by an ancestor Card's `overflow-hidden`. The
        // prose plugin sets this by default, but we enforce it
        // explicitly so the behaviour does not depend on
        // @tailwindcss/typography version drift.
        '[&_pre]:overflow-x-auto',
        className,
      )}
    >
      <ReactMarkdown
        remarkPlugins={remarkPlugins}
        rehypePlugins={[rehypeRaw, rehypeKatex]}
        components={components}
      >
        {children}
      </ReactMarkdown>
    </div>
  )
}

function replaceSamePathArtifactHistory(
  event: React.MouseEvent<HTMLAnchorElement>,
  href: string,
): void {
  if (
    event.defaultPrevented ||
    event.button !== 0 ||
    event.metaKey ||
    event.ctrlKey ||
    event.shiftKey ||
    event.altKey ||
    event.currentTarget.target === '_blank' ||
    typeof window === 'undefined'
  ) {
    return
  }
  const destination = new URL(href, window.location.href)
  if (
    destination.origin !== window.location.origin ||
    destination.pathname !== window.location.pathname
  ) {
    return
  }
  event.preventDefault()
  replaceWorkspaceHistory(`${destination.pathname}${destination.search}${destination.hash}`)
}

interface MarkdownAstNode {
  type: string
  value?: string
  alt?: string
  url?: string
  depth?: number
  children?: MarkdownAstNode[]
  data?: { hName?: string; hProperties?: Record<string, unknown> }
}

interface TableOfContentsEntry {
  depth: number
  id: string
  label: string
}

function transformReportTableOfContents(
  root: MarkdownAstNode,
  options: MarkdownTableOfContentsOptions,
): void {
  if (!root.children) return
  const minDepth = Math.max(1, Math.min(6, options.minDepth ?? 2))
  const maxDepth = Math.max(minDepth, Math.min(6, options.maxDepth ?? 6))
  const prefix = normalizeHeadingPrefix(options.headingIdPrefix)
  const occurrences = new Map<string, number>()
  const entries: TableOfContentsEntry[] = []

  visitMarkdownNodes(root, (node) => {
    if (node.type !== 'heading' || !node.depth) return
    const label = markdownNodeText(node).trim() || 'Section'
    const baseId = `${prefix}${markdownHeadingSlug(label)}`
    const occurrence = occurrences.get(baseId) ?? 0
    occurrences.set(baseId, occurrence + 1)
    const id = occurrence === 0 ? baseId : `${baseId}-${occurrence}`
    node.data = {
      ...node.data,
      hProperties: {
        ...node.data?.hProperties,
        id,
        className: mergeClassNames(node.data?.hProperties?.className, 'scroll-mt-16'),
      },
    }
    if (node.depth >= minDepth && node.depth <= maxDepth) {
      entries.push({ depth: node.depth, id, label })
    }
  })

  if (entries.length === 0) return
  const title = options.title ?? 'Table of contents'
  root.children.unshift(buildTableOfContentsNode(entries, title, minDepth))
}

function buildTableOfContentsNode(
  entries: TableOfContentsEntry[],
  title: string,
  minDepth: number,
): MarkdownAstNode {
  return {
    type: 'reportTableOfContents',
    data: {
      hName: 'nav',
      hProperties: {
        'aria-label': title,
        'data-report-toc': '',
        className: ['not-prose', 'mb-6', 'rounded-lg', 'border', 'bg-muted/30', 'p-4', 'text-sm'],
      },
    },
    children: [
      {
        type: 'paragraph',
        data: {
          hName: 'div',
          hProperties: {
            className: [
              'mb-2',
              'text-xs',
              'font-semibold',
              'uppercase',
              'tracking-wide',
              'text-muted-foreground',
            ],
          },
        },
        children: [{ type: 'text', value: title }],
      },
      {
        type: 'list',
        data: {
          hProperties: {
            className: ['m-0', 'space-y-1', 'p-0'],
          },
        },
        children: entries.map((entry) => ({
          type: 'listItem',
          data: {
            hProperties: {
              className: [
                'list-none',
                tableOfContentsIndentClass(Math.max(0, entry.depth - minDepth)),
              ],
            },
          },
          children: [
            {
              type: 'paragraph',
              children: [
                {
                  type: 'link',
                  url: `#${entry.id}`,
                  data: {
                    hProperties: {
                      className: [
                        'block',
                        'rounded-sm',
                        'px-1.5',
                        'py-1',
                        'text-foreground/80',
                        'no-underline',
                        'hover:bg-accent',
                        'hover:text-accent-foreground',
                        'focus-visible:outline-none',
                        'focus-visible:ring-2',
                        'focus-visible:ring-ring',
                      ],
                    },
                  },
                  children: [{ type: 'text', value: entry.label }],
                },
              ],
            },
          ],
        })),
      },
    ],
  }
}

function visitMarkdownNodes(node: MarkdownAstNode, visit: (node: MarkdownAstNode) => void): void {
  visit(node)
  for (const child of node.children ?? []) visitMarkdownNodes(child, visit)
}

function markdownNodeText(node: MarkdownAstNode): string {
  if (typeof node.value === 'string') return node.value
  if (typeof node.alt === 'string') return node.alt
  return (node.children ?? []).map(markdownNodeText).join('')
}

function normalizeHeadingPrefix(value: string): string {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return normalized ? `${normalized}-` : 'report-'
}

function markdownHeadingSlug(value: string): string {
  const slug = value
    .normalize('NFKC')
    .trim()
    .toLowerCase()
    .replace(/[^\p{Letter}\p{Number}\s-]/gu, '')
    .replace(/[\s-]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return slug || 'section'
}

function mergeClassNames(current: unknown, next: string): string[] {
  if (Array.isArray(current)) return [...current.map(String), next]
  if (typeof current === 'string' && current.trim()) return [...current.split(/\s+/), next]
  return [next]
}

function tableOfContentsIndentClass(level: number): string {
  if (level <= 0) return 'ml-0'
  if (level === 1) return 'ml-3'
  if (level === 2) return 'ml-6'
  if (level === 3) return 'ml-9'
  return 'ml-12'
}

const BARE_ARTIFACT_RE = /(?:E\d{4}(?:-[a-z0-9][a-z0-9-]*)?|R\d{4})/g
const ARTIFACT_ID_CHARACTER_RE = /[A-Za-z0-9_-]/
const AST_SKIP_TYPES = new Set([
  'link',
  'linkReference',
  'inlineCode',
  'code',
  'math',
  'inlineMath',
  'html',
])

function transformBareArtifactReferences(
  root: MarkdownAstNode,
  context: MarkdownArtifactLinkContext,
): void {
  visitMarkdownNode(root)

  function visitMarkdownNode(node: MarkdownAstNode): void {
    if (AST_SKIP_TYPES.has(node.type) || !node.children) return
    const nextChildren: MarkdownAstNode[] = []
    let rawHtmlDepth = 0
    for (const child of node.children) {
      if (child.type === 'html') {
        rawHtmlDepth = rawHtmlNestingAfter(child.value ?? '', rawHtmlDepth)
        nextChildren.push(child)
      } else if (rawHtmlDepth > 0) {
        // mdast represents inline `<span>R0001</span>` as an opening html
        // sibling, an ordinary text sibling, and a closing html sibling.
        // Track that small raw-HTML island so its text is not transformed.
        nextChildren.push(child)
      } else if (child.type === 'text' && typeof child.value === 'string') {
        nextChildren.push(...linkBareArtifactText(child.value, context))
      } else {
        visitMarkdownNode(child)
        nextChildren.push(child)
      }
    }
    node.children = nextChildren
  }
}

const HTML_VOID_ELEMENTS = new Set([
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

function rawHtmlNestingAfter(html: string, initialDepth: number): number {
  let depth = initialDepth
  const tagRe = /<(\/)?([A-Za-z][A-Za-z0-9:-]*)(?:\s[^<>]*?)?(\/?)>/g
  for (let match = tagRe.exec(html); match; match = tagRe.exec(html)) {
    const closing = match[1] === '/'
    const name = match[2]!.toLowerCase()
    const selfClosing = match[3] === '/' || HTML_VOID_ELEMENTS.has(name)
    if (closing) depth = Math.max(0, depth - 1)
    else if (!selfClosing) depth += 1
  }
  return depth
}

function linkBareArtifactText(
  value: string,
  context: MarkdownArtifactLinkContext,
): MarkdownAstNode[] {
  const nodes: MarkdownAstNode[] = []
  let cursor = 0
  let changed = false
  BARE_ARTIFACT_RE.lastIndex = 0
  for (let match = BARE_ARTIFACT_RE.exec(value); match; match = BARE_ARTIFACT_RE.exec(value)) {
    const reference = match[0]
    const start = match.index
    const end = start + reference.length
    const before = value[start - 1]
    const after = value[end]
    if (
      (before !== undefined && ARTIFACT_ID_CHARACTER_RE.test(before)) ||
      (after !== undefined && ARTIFACT_ID_CHARACTER_RE.test(after))
    ) {
      continue
    }

    const target = resolveBareArtifactReference(reference, context.inventory)
    const href = target ? context.getArtifactHref(target, context.sourceSurface) : null
    if (!target || !href) continue

    if (start > cursor) nodes.push({ type: 'text', value: value.slice(cursor, start) })
    nodes.push({
      type: 'link',
      url: href,
      children: [{ type: 'text', value: reference }],
      data: {
        hProperties: {
          'data-memon-artifact-kind': target.kind,
          'data-memon-artifact-id': target.id,
        },
      },
    })
    cursor = end
    changed = true
  }
  if (!changed) return [{ type: 'text', value }]
  if (cursor < value.length) nodes.push({ type: 'text', value: value.slice(cursor) })
  return nodes
}

function generatedArtifactTarget(
  node: unknown,
  inventory: ArtifactInventory,
): ArtifactTarget | null {
  const properties = (node as { properties?: Record<string, unknown> } | undefined)?.properties
  const kind = properties?.dataMemonArtifactKind ?? properties?.['data-memon-artifact-kind']
  const id = properties?.dataMemonArtifactId ?? properties?.['data-memon-artifact-id']
  if ((kind !== 'experiment' && kind !== 'report') || typeof id !== 'string') return null
  const resolved = resolveBareArtifactReference(id, inventory)
  return resolved?.kind === kind ? resolved : null
}

function decorateArtifactIdentifier(children: ReactNode, target: ArtifactTarget): ReactNode {
  const shortId = target.kind === 'experiment' ? target.id.slice(0, 5) : target.id
  return Children.map(children, (child) => decorateArtifactNode(child, shortId))
}

function decorateArtifactNode(node: ReactNode, shortId: string): ReactNode {
  if (typeof node === 'string') return decorateArtifactText(node, shortId)
  if (!isValidElement<{ children?: ReactNode }>(node) || node.props.children === undefined) {
    return node
  }
  return cloneElement(node as ReactElement<{ children?: ReactNode }>, {
    children: Children.map(node.props.children, (child) => decorateArtifactNode(child, shortId)),
  })
}

function decorateArtifactText(value: string, shortId: string): ReactNode {
  const parts: ReactNode[] = []
  let cursor = 0
  let occurrence = 0
  for (let at = value.indexOf(shortId); at >= 0; at = value.indexOf(shortId, at + shortId.length)) {
    const before = value[at - 1]
    const after = value[at + shortId.length]
    if (
      (before !== undefined && /[A-Za-z0-9_]/.test(before)) ||
      (after !== undefined && /[A-Za-z0-9_]/.test(after))
    ) {
      continue
    }
    if (at > cursor) parts.push(value.slice(cursor, at))
    parts.push(
      <span key={`${shortId}:${occurrence}`} className="font-bold text-primary">
        {shortId}
      </span>,
    )
    occurrence += 1
    cursor = at + shortId.length
  }
  if (occurrence === 0) return value
  if (cursor < value.length) parts.push(value.slice(cursor))
  return parts
}

/**
 * Convert a safe relative report URL to the report-scoped resource endpoint.
 * Dot-segments are rejected before the browser gets a chance to normalize
 * them out of the endpoint prefix. The server independently performs lexical
 * and realpath containment checks.
 */
export function resolveReportResourceUrl(baseUrl: string, source: string): string | null {
  if (
    source.length === 0 ||
    source.startsWith('/') ||
    source.startsWith('#') ||
    source.startsWith('//') ||
    /^[a-z][a-z0-9+.-]*:/i.test(source)
  ) {
    return null
  }

  const match = /^([^?#]*)([?#][\s\S]*)?$/.exec(source)
  const rawPath = match?.[1] ?? source
  const suffix = match?.[2] ?? ''
  const rawSegments = rawPath.split('/')
  while (rawSegments[0] === '.') rawSegments.shift()
  if (rawSegments.length === 0 || rawSegments.some((segment) => segment.length === 0)) return null

  const encoded: string[] = []
  for (const raw of rawSegments) {
    let decoded: string
    try {
      decoded = decodeURIComponent(raw)
    } catch {
      return null
    }
    if (decoded === '.' || decoded === '..' || decoded.includes('/') || decoded.includes('\\')) {
      return null
    }
    encoded.push(encodeURIComponent(decoded))
  }
  return `${baseUrl.replace(/\/$/, '')}/${encoded.join('/')}${suffix}`
}

function isHtmlResource(source: string): boolean {
  const path = source.split(/[?#]/, 1)[0] ?? ''
  return /\.html?$/i.test(path)
}

function containsReportHtmlImage(node: unknown, resourceBaseUrl?: string): boolean {
  if (!resourceBaseUrl) return false
  const children = (node as { children?: unknown[] } | undefined)?.children
  if (!children) return false
  return children.some((child) => {
    const element = child as
      | {
          type?: string
          tagName?: string
          properties?: Record<string, unknown>
        }
      | undefined
    if (element?.type !== 'element' || element.tagName !== 'img') return false
    const source = element.properties?.src
    return (
      typeof source === 'string' &&
      isHtmlResource(source) &&
      resolveReportResourceUrl(resourceBaseUrl, source) !== null
    )
  })
}
