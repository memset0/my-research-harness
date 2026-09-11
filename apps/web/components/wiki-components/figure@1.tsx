'use client'
import { TranslatedLiteral } from '../body-translation'

import { useState } from 'react'
import { projectHost, projectName, type ProjectTarget } from '../../lib/api'
import type { FigureV1 } from '../../lib/wiki-components/figure@1'

export function FigureBlock({ data, project }: { data: FigureV1; project?: ProjectTarget }) {
  const [failedSource, setFailedSource] = useState<string | null>(null)
  let source: string | null = null
  if (project) {
    const name = projectName(project)
    const base = `/api/wiki-assets/${encodeURIComponent(name)}/shared/${encodeURIComponent(data.src.slice('assets/'.length))}`
    const host = projectHost(project)
    source = host ? `${base}?${new URLSearchParams({ host, project: name })}` : base
  }

  return (
    <figure className="not-prose my-6" data-wiki-figure={data.slug}>
      {source && failedSource !== source ? (
        <img
          src={source}
          alt={data.description}
          loading="lazy"
          decoding="async"
          className="mx-auto block h-auto max-w-full"
          onError={() => setFailedSource(source)}
        />
      ) : (
        <div role="status" className="border border-border p-4 text-sm text-muted-foreground">
          <p>
            {source ? `Image unavailable: ${data.src}` : 'Figure image requires a project context.'}
          </p>
          <p>{data.description}</p>
        </div>
      )}
      <figcaption className="mt-2 text-center text-sm text-muted-foreground">
        <TranslatedLiteral>{data.caption}</TranslatedLiteral>
      </figcaption>
    </figure>
  )
}
