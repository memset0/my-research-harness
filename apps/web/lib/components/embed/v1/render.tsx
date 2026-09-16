'use client'

import { ReportHtmlEmbed } from '../../../../components/report-html-embed'
import type { ComponentData, ComponentRenderer } from '../../types'
import type { descriptor } from './index'

function escapeHtmlAttribute(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
}

function withAssetBase(html: string, resource: string | null): string {
  if (!resource) return html
  const query = resource.indexOf('?')
  const path = query === -1 ? resource : resource.slice(0, query)
  const suffix = query === -1 ? '' : resource.slice(query)
  const directory = `${path.replace(/\/$/, '')}/${suffix}`
  const base = `<base href="${escapeHtmlAttribute(directory)}">`
  const head = /<head[^>]*>/i.exec(html)
  if (head) {
    const at = head.index + head[0].length
    return `${html.slice(0, at)}${base}${html.slice(at)}`
  }
  const doctype = /^\s*<!doctype[^>]*>/i.exec(html)
  const at = doctype ? doctype[0].length : 0
  return `${html.slice(0, at)}${base}${html.slice(at)}`
}

export const Render: ComponentRenderer<ComponentData<typeof descriptor>> = ({ data, block }) => (
  <div className="not-prose min-w-0" data-component={`embed@${block.version}`}>
    <ReportHtmlEmbed
      srcDoc={withAssetBase(data.data, block.resourceUrl(''))}
      title={data.title ?? 'Embedded HTML'}
      height={data.height}
    />
  </div>
)
