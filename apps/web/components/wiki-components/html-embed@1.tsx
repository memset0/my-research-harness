'use client'

import type { HtmlEmbedV1 } from '../../lib/wiki-components/html-embed@1'
import { ReportHtmlEmbed } from '../report-html-embed'

/**
 * Inject a `<base href>` so `./data/*` and `./views/*` inside the embedded
 * document resolve against the containing page's asset route. A `srcdoc`
 * document otherwise inherits the dashboard page URL as its base, which would
 * send those requests to an application route.

 */

function escapeHtmlAttribute(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
}

function withAssetBase(html: string, assetBase: string | null): string {
  if (!assetBase) return html
  const base = `<base href="${escapeHtmlAttribute(assetBase.replace(/\/$/, ''))}/">`
  const head = /<head[^>]*>/i.exec(html)
  if (head) {
    const at = head.index + head[0].length
    return `${html.slice(0, at)}${base}${html.slice(at)}`
  }
  const doctype = /^\s*<!doctype[^>]*>/i.exec(html)
  const at = doctype ? doctype[0].length : 0
  return `${html.slice(0, at)}${base}${html.slice(at)}`
}

export function HtmlEmbedBlock({
  data,
  assetBase,
}: {
  data: HtmlEmbedV1
  assetBase: string | null
}) {
  return (
    <div className="not-prose min-w-0" data-wiki-component="html-embed@1">
      <ReportHtmlEmbed
        srcDoc={withAssetBase(data.html, assetBase)}
        title={data.title ?? 'Embedded HTML'}
        height={data.height}
      />
    </div>
  )
}
