'use client'

import Link from 'next/link'
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
import ReactMarkdown, { type Components, type ExtraProps } from 'react-markdown'
import rehypeKatex from 'rehype-katex'
import rehypeRaw from 'rehype-raw'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import { TranslationText, useBodyTranslation } from './body-translation'
import {
  removeGeneratedAutolinks,
  segmentMarkdownTree,
  type ProseNode,
  type TranslationSegment,
} from '../lib/translation/segments'
import 'katex/dist/katex.min.css'
import type { ProjectTarget } from '../lib/api'
import {
  type ArtifactInventory,
  type ArtifactTarget,
  resolveArtifactMarkdownHref,
  resolveBareArtifactReference,
} from '../lib/artifact-links'
import { resolveDocumentResourceUrl } from '../lib/document-resource-url'
import {
  markdownHeadingSlug,
  normalizeHeadingIdPrefix,
} from '../lib/markdown-outline'
import type { ArtifactSourceSurface } from '../lib/report-workspace-url'
import { handleFragmentClick } from '../lib/scroll-to-fragment'
import { cn } from '../lib/utils'
import { resolveComponentBlock, type ResolvedBlock } from '../lib/components/registry'
import type { ComponentDocumentRef } from '../lib/components/types'
import { replaceWorkspaceHistory } from '../lib/workspace-history'
import { GithubPermalinkPreview, isGithubBlobPermalink } from './github-permalink-preview'
import { ReportHtmlEmbed } from './report-html-embed'
import { ComponentBlockView } from './components'

export type MarkdownArtifactSourceSurface = ArtifactSourceSurface

export interface MarkdownArtifactLinkContext {
  inventory: ArtifactInventory
  /** Absolute or project-relative source Markdown path returned by the detail API. */
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

export interface MarkdownUnverifiedOptions {
  /**
   * Inclusive 1-based line ranges, in SOURCE FILE coordinates, whose content
   * is not covered by the verified wiki-commit prefix.
   */
  ranges: readonly (readonly [number, number])[]
  /** Source-file line number of the first line of `children`. Defaults to 1. */
  lineOffset?: number
  /** Hover title applied to every tinted block. */
  title?: string
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
  headingIdPrefix,
  unverified,
  document,
}: {
  children: string
  className?: string
  // When set, GitHub blob line-permalinks in the body become hover-preview
  // links (code is fetched from the project's mapped LOCAL repo). Omit it
  // and links render as plain external anchors. Threaded from every page
  // that knows which project the markdown belongs to.
  project?: ProjectTarget
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
  /**
   * Anchors headings without prepending an outline, for surfaces that render
   * the outline themselves (the wiki reading pane's sticky column).
   * Ignored when `tableOfContents` is set, which already anchors them.
   */
  headingIdPrefix?: string
  /** Tints the top-level blocks whose source lines are not yet verified. */
  unverified?: MarkdownUnverifiedOptions
  document?: ComponentDocumentRef
}) {
  const inheritedArtifactLinks = useContext(ArtifactLinkContext)
  const translation = useBodyTranslation()
  const translationSegments = useMemo(() => new Map<string, TranslationSegment>(), [children])
  const translationEnabled = translation !== null
  const translationPlugin = useMemo(
    () => translationEnabled ? () => (tree: ProseNode) => {
      for (const segment of segmentMarkdownTree(tree, children, true)) {
        translationSegments.set(segment.id, segment)
      }
    } : null,
    [children, translationEnabled, translationSegments],
  )
  const activeArtifactLinks = artifactLinks === undefined ? inheritedArtifactLinks : artifactLinks
  const components = useMemo<Components>(
    () => ({
      ...BASE_COMPONENTS,
      span: ({ node, children: spanChildren, ...rest }) => {
        const segment = translationSegments.get(String(node?.properties?.dataMemonTranslation ?? ''))
        if (segment) return (
          <TranslationText segment={segment} render={(text) => (
            <ReactMarkdown
              skipHtml
              remarkPlugins={[
                remarkGfm,
                remarkMath,
                () => (tree: ProseNode) => removeGeneratedAutolinks(tree, text),
              ]}
              rehypePlugins={[rehypeKatex]}
              components={{ ...components, p: 'span' }}
            >
              {text}
            </ReactMarkdown>
          )} />
        )
        return <span {...rest}>{spanChildren}</span>
      },
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
              // `group/artifact` is what lets the inline badge rendered by
              // `decorateArtifactText` react to hover on the whole anchor,
              // which is the only remaining clickability cue now that the
              // typography underline is suppressed for artifact links.
              className={cn('group/artifact', rest.className)}
              onClick={(event) => replaceSamePathArtifactHistory(event, artifactHref)}
              data-memon-artifact-kind={artifactTarget.kind}
              data-memon-artifact-id={artifactTarget.id}
            >
              {decorateArtifactIdentifier(linkChildren, artifactTarget)}
            </Link>
          )
        }

        const resolvedHref =
          href && resourceBaseUrl ? (resolveDocumentResourceUrl(resourceBaseUrl, href) ?? href) : href
        const external = !!resolvedHref && /^https?:\/\//i.test(resolvedHref)
        const fragment = !!resolvedHref && resolvedHref.startsWith('#')
        return (
          <a
            href={resolvedHref}
            {...(external ? { target: '_blank', rel: 'noreferrer noopener' } : {})}
            {...(fragment
              ? { onClick: (event: React.MouseEvent<HTMLAnchorElement>) => handleFragmentClick(event, resolvedHref) }
              : {})}
            {...rest}
          >
            {linkChildren}
          </a>
        )
      },
      img: ({ node: _node, src, alt, title, ...rest }) => {
        const resolvedSrc =
          typeof src === 'string' && resourceBaseUrl
            ? resolveDocumentResourceUrl(resourceBaseUrl, src)
            : null
        if (resolvedSrc && typeof src === 'string' && isHtmlResource(src)) {
          return (
            <ReportHtmlEmbed src={resolvedSrc} title={alt || title || 'Embedded HTML report'} />
          )
        }
        return <img src={resolvedSrc ?? src} alt={alt ?? ''} title={title} {...rest} />
      },
      // A fenced block whose language names a registered wiki component
      // renders as that component on every Markdown surface. Anything else —
      // including an unregistered language and a component block that fails
      // validation — keeps the ordinary code block, so unknown components
      // degrade instead of breaking the page.
      pre: ({ node, children: preChildren, ...rest }) => {
        const block = componentBlockFromPre(node)
        if (block) return <ComponentBlockView block={block} document={document} />
        return <pre {...rest}>{preChildren}</pre>
      },
    }),
    [activeArtifactLinks, document, project, resourceBaseUrl, translationSegments],
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
  const headingIdRemarkPlugin = useMemo(
    () =>
      !tableOfContents && headingIdPrefix
        ? () => (tree: MarkdownAstNode) => {
            assignHeadingIds(tree, headingIdPrefix, 1, 6)
          }
        : null,
    [headingIdPrefix, tableOfContents],
  )
  const unverifiedRemarkPlugin = useMemo(
    () =>
      unverified && unverified.ranges.length > 0
        ? () => (tree: MarkdownAstNode) => transformUnverifiedRegions(tree, unverified)
        : null,
    [unverified],
  )
  const remarkPlugins = useMemo(
    () => [
      remarkGfm,
      remarkMath,
      remarkFenceMeta,
      ...(translationPlugin ? [translationPlugin] : []),
      ...(artifactRemarkPlugin ? [artifactRemarkPlugin] : []),
      ...(tableOfContentsRemarkPlugin ? [tableOfContentsRemarkPlugin] : []),
      ...(headingIdRemarkPlugin ? [headingIdRemarkPlugin] : []),
      ...(unverifiedRemarkPlugin ? [unverifiedRemarkPlugin] : []),
    ],
    [
      artifactRemarkPlugin,
      headingIdRemarkPlugin,
      tableOfContentsRemarkPlugin,
      unverifiedRemarkPlugin,
      translationPlugin,
    ],
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
        // Artifact references render their identifier as an inline badge
        // (see ARTIFACT_BADGE_CLASS). The typography plugin's link underline
        // would strike through the chip — and text-decoration set on an
        // ancestor cannot be cancelled by a descendant — so it has to be
        // dropped on the anchor itself. Scoped to artifact anchors via the
        // `data-memon-artifact-*` properties, so ordinary Markdown links keep
        // their underline. Specificity here is 0,2,0 (class + attribute),
        // strictly higher than the plugin's `.prose :where(a)` at 0,1,0, so
        // the reset wins independently of layer/source order.
        '[&_a[data-memon-artifact-kind]]:no-underline',
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

interface HastCodeElement {
  type?: string
  tagName?: string
  properties?: Record<string, unknown>
  data?: { meta?: unknown }
  children?: { value?: unknown }[]
}

/** The `node` react-markdown hands to the `pre` renderer. */
type HastPreElement = NonNullable<ExtraProps['node']>

/**
 * Copy each fenced block's info-string remainder onto the emitted `<code>`
 * element as `data-fence-meta`. `mdast-util-to-hast` parks it in `data.meta`,
 * which `rehype-raw` discards when it re-parses the tree, so the attribute is
 * the only channel that survives to the renderer.
 */
function remarkFenceMeta() {
  return (tree: MarkdownAstNode) => {
    visitMarkdownNodes(tree, (node) => {
      if (node.type !== 'code' || typeof node.meta !== 'string' || node.meta.length === 0) return
      node.data = {
        ...node.data,
        hProperties: { ...node.data?.hProperties, 'data-fence-meta': node.meta },
      }
    })
  }
}

/**
 * Reassemble the complete info string from react-markdown's `language-*`
 * class and our preserved `data-fence-meta`, then resolve it once through the
 * registry. Ordinary code blocks return null; invalid component declarations
 * remain resolvable so `ComponentBlockView` can show their diagnostic beside
 * the verbatim payload.
 */
function componentBlockFromPre(node: HastPreElement | undefined): ResolvedBlock | null {
  const children = node?.children
  if (!children || children.length !== 1) return null
  const code = children[0] as HastCodeElement
  if (code.type !== 'element' || code.tagName !== 'code') return null
  const classNames = code.properties?.className
  const language = (Array.isArray(classNames) ? classNames : [])
    .map(String)
    .find((entry) => entry.startsWith('language-'))
    ?.slice('language-'.length)
  if (!language) return null
  const rawMeta = code.properties?.dataFenceMeta ?? code.data?.meta
  const meta = typeof rawMeta === 'string' ? rawMeta : ''
  const payload = (code.children ?? [])
    .map((child) => (typeof child.value === 'string' ? child.value : ''))
    .join('')
    .replace(/\n$/, '')
  return resolveComponentBlock(
    { info: meta ? `${language} ${meta}` : language, payload },
    0,
    node.position?.start.line ?? 1,
  )
}

interface MarkdownAstNode {
  type: string
  value?: string
  alt?: string
  url?: string
  depth?: number
  /** Info-string remainder of a fenced block, e.g. `height=280 title="x"`. */
  meta?: string
  children?: MarkdownAstNode[]
  position?: { start: { line: number }; end: { line: number } }
  data?: { hName?: string; hProperties?: Record<string, unknown> }
}

interface TableOfContentsEntry {
  depth: number
  id: string
  label: string
}

/**
 * Anchor every heading and report the ones inside the requested depth band.
 *
 * Ids are assigned to all six levels regardless of the band so the occurrence
 * counter — and therefore every id — is independent of which levels a caller
 * chose to list.
 */
function assignHeadingIds(
  root: MarkdownAstNode,
  headingIdPrefix: string,
  minDepth: number,
  maxDepth: number,
): TableOfContentsEntry[] {
  const prefix = normalizeHeadingIdPrefix(headingIdPrefix)
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

  return entries
}

function transformReportTableOfContents(
  root: MarkdownAstNode,
  options: MarkdownTableOfContentsOptions,
): void {
  if (!root.children) return
  const minDepth = Math.max(1, Math.min(6, options.minDepth ?? 2))
  const maxDepth = Math.max(minDepth, Math.min(6, options.maxDepth ?? 6))
  const entries = assignHeadingIds(root, options.headingIdPrefix, minDepth, maxDepth)

  if (entries.length === 0) return
  const title = options.title ?? 'Table of contents'
  root.children.unshift(buildTableOfContentsNode(entries, title, minDepth))
}

/**
 * Tint the top-level blocks whose source lines intersect an unverified range.
 *
 * Only root children are considered: the review data is line-based, and a
 * whole block is the smallest unit a reader can attribute to a commit.
 */
function transformUnverifiedRegions(
  root: MarkdownAstNode,
  options: MarkdownUnverifiedOptions,
): void {
  const offset = (options.lineOffset ?? 1) - 1
  for (const child of root.children ?? []) {
    const start = child.position?.start.line
    const end = child.position?.end.line
    if (start === undefined || end === undefined) continue
    const absoluteStart = start + offset
    const absoluteEnd = end + offset
    const intersects = options.ranges.some(
      ([rangeStart, rangeEnd]) => rangeStart <= absoluteEnd && rangeEnd >= absoluteStart,
    )
    if (!intersects) continue
    child.data = {
      ...child.data,
      hProperties: {
        ...child.data?.hProperties,
        'data-wiki-unverified': '',
        ...(options.title ? { title: options.title } : {}),
        className: mergeClassNames(
          child.data?.hProperties?.className,
          'border-l-4 border-l-muted-foreground/40 bg-muted/50 pl-3',
        ),
      },
    }
  }
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

const BARE_ARTIFACT_RE = /(?:E\d{4}(?:-[a-z0-9][a-z0-9-]*)?|R\d{4}|W\d{4})/g
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
  if (
    (kind !== 'experiment' && kind !== 'report' && kind !== 'wiki') ||
    typeof id !== 'string'
  ) {
    return null
  }
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

/**
 * Inline chip for a recognized artifact identifier inside running prose.
 *
 * Deliberately a plain `display: inline` <span>, NOT `inline-flex` and NOT
 * shadcn's <Badge> (which is `inline-flex h-5 text-[0.625rem]`): an
 * inline-level *block* container contributes its own box height to the line
 * box, so a fixed-height pill pushes lines apart in a paragraph — the exact
 * failure mode this styling has to avoid. For a non-replaced inline box, CSS
 * line-box height is driven by `line-height` alone; horizontal padding,
 * border and background paint outside that calculation and cannot grow it.
 * Hence: `px-1` only, no vertical padding, `align-baseline`.
 *
 * Sizing is relative (`text-[0.9em]`) so the chip stays proportional both in
 * full-size prose and in the `text-xs/relaxed` surfaces; with the inherited
 * unitless prose `line-height`, a smaller font-size yields a *smaller* used
 * line-height than the paragraph strut, so it can never be the tallest box
 * on the line.
 */
const ARTIFACT_BADGE_CLASS = cn(
  'rounded-sm border border-border bg-muted px-1 align-baseline',
  'font-mono text-[0.9em] font-medium whitespace-nowrap text-foreground',
  'transition-colors group-hover/artifact:border-primary/40',
  'group-hover/artifact:bg-primary/10 group-hover/artifact:text-primary',
)

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
      <span
        key={`${shortId}:${occurrence}`}
        data-artifact-badge=""
        className={ARTIFACT_BADGE_CLASS}
      >
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
      resolveDocumentResourceUrl(resourceBaseUrl, source) !== null
    )
  })
}
