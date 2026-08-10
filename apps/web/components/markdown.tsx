'use client'

import { useMemo } from 'react'
import ReactMarkdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import rehypeKatex from 'rehype-katex'
import 'katex/dist/katex.min.css'
import { cn } from '../lib/utils'
import { GithubPermalinkPreview, isGithubBlobPermalink } from './github-permalink-preview'

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
}) {
  const components = useMemo<Components>(
    () => ({
      ...BASE_COMPONENTS,
      a: ({ node: _node, href, children: linkChildren, ...rest }) => {
        if (project && href && isGithubBlobPermalink(href)) {
          return (
            <GithubPermalinkPreview href={href} project={project}>
              {linkChildren}
            </GithubPermalinkPreview>
          )
        }
        const resolvedHref =
          href && resourceBaseUrl ? resolveReportResourceUrl(resourceBaseUrl, href) ?? href : href
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
            <iframe
              src={resolvedSrc}
              title={alt || title || 'Embedded HTML report'}
              className="my-4 h-[70vh] min-h-[32rem] w-full rounded-md border bg-background"
              loading="lazy"
              data-report-html
            />
          )
        }
        return <img src={resolvedSrc ?? src} alt={alt ?? ''} title={title} {...rest} />
      },
    }),
    [project, resourceBaseUrl],
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
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[rehypeKatex]}
        components={components}
      >
        {children}
      </ReactMarkdown>
    </div>
  )
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
