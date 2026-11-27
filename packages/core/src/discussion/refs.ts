import { posix } from 'node:path'
import remarkParse from 'remark-parse'
import { unified } from 'unified'
import type {
  DiscussionDiagnostic,
  DiscussionEvent,
  DiscussionRef,
  QuestionMetadata,
} from './model.js'

/** A Report registration as published in the Reports catalog. */
export interface ReportRegistration {
  id: string
  resource: string
  title: string
}

interface LinkNode {
  type: string
  url?: string
  children?: LinkNode[]
}
function linkTargets(markdown: string): string[] {
  const urls: string[] = []
  const visit = (node: LinkNode) => {
    if ((node.type === 'link' || node.type === 'definition') && node.url) urls.push(node.url)
    node.children?.forEach(visit)
  }
  visit(unified().use(remarkParse).parse(markdown) as unknown as LinkNode)
  return urls
}

/** The Report a relative Markdown link from `fromResource` points into, if any. */
function linkedReport(
  url: string,
  fromResource: string,
  reports: readonly ReportRegistration[],
): { report: ReportRegistration; anchor?: string } | null {
  if (/^[a-z][a-z0-9+.-]*:/i.test(url) || url.startsWith('/') || url.startsWith('#')) return null
  const [rawPath = '', rawAnchor] = url.split('#', 2)
  let path: string
  try {
    path = decodeURIComponent(rawPath.split('?')[0]!)
  } catch {
    return null
  }
  const target = posix.normalize(posix.join(posix.dirname(fromResource), path)).replace(/\/$/, '')
  for (const report of reports) {
    const bundle = /\/(README\.md|manifest\.json)$/.test(report.resource)
      ? posix.dirname(report.resource)
      : null
    if (
      target === report.resource ||
      (bundle && (target === bundle || target.startsWith(`${bundle}/`)))
    )
      return { report, ...(rawAnchor ? { anchor: rawAnchor } : {}) }
  }
  return null
}

/**
 * Resolve every Report citation of each question: its `refs` field, and relative links in its
 * description and agent replies. Unresolved `refs` entries become diagnostics; unresolved links
 * are ordinary Markdown and are ignored.
 */
export function resolveDiscussionRefs(
  discussionResource: string,
  questions: ReadonlyArray<{
    line: number
    body: string
    metadata: Pick<QuestionMetadata, 'id' | 'refs'> | null
  }>,
  events: readonly DiscussionEvent[],
  reports: readonly ReportRegistration[],
): { refs: Map<string, DiscussionRef[]>; diagnostics: DiscussionDiagnostic[] } {
  const byId = new Map(reports.map((r) => [r.id, r]))
  const refs = new Map<string, DiscussionRef[]>()
  const diagnostics: DiscussionDiagnostic[] = []
  for (const q of questions) {
    if (!q.metadata) continue
    const id = q.metadata.id
    const found: DiscussionRef[] = []
    const seen = new Set<string>()
    const add = (ref: DiscussionRef) => {
      const key = `${ref.source}:${ref.report}#${ref.anchor ?? ''}`
      if (seen.has(key)) return
      seen.add(key)
      found.push(ref)
    }
    for (const entry of q.metadata.refs ?? []) {
      const [reportId = '', anchor] = entry.split('#', 2)
      const report = byId.get(reportId)
      if (!report) {
        diagnostics.push({
          line: q.line,
          question: id,
          message: `ref ${entry} is not a registered Report`,
        })
        continue
      }
      add({
        report: report.id,
        ...(anchor ? { anchor } : {}),
        title: report.title,
        resource: report.resource,
        source: 'field',
      })
    }
    const texts = [
      q.body,
      ...events.flatMap((e) => (e.type === 'reply' && e.question === id ? [e.text] : [])),
    ]
    for (const text of texts)
      for (const url of linkTargets(text)) {
        const hit = linkedReport(url, discussionResource, reports)
        if (hit)
          add({
            report: hit.report.id,
            ...(hit.anchor ? { anchor: hit.anchor } : {}),
            title: hit.report.title,
            resource: hit.report.resource,
            source: 'link',
          })
      }
    if (found.length) refs.set(id, found)
  }
  return { refs, diagnostics }
}
