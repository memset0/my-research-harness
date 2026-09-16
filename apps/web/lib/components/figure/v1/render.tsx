'use client'

import { useState } from 'react'
import type { ComponentData, ComponentRenderer } from '../../types'
import type { descriptor } from './index'

export const Render: ComponentRenderer<ComponentData<typeof descriptor>> = ({ data, block }) => {
  const source = block.resourceUrl(data.image)
  const [failed, setFailed] = useState<string | null>(null)
  const available = source !== null && failed !== source
  return (
    <figure className="not-prose my-6" data-component={`figure@${block.version}`}>
      {available ? (
        <img
          src={source}
          alt={data.description ?? data.caption}
          loading="lazy"
          decoding="async"
          className="mx-auto block h-auto max-w-full"
          onError={() => setFailed(source)}
        />
      ) : (
        <div role="status" className="border border-border p-4 text-sm text-muted-foreground">
          <p>{source ? `Image unavailable: ${data.image}` : 'Figure image requires a document context.'}</p>
          <p className="font-medium text-foreground">{data.caption}</p>
          {data.description && <p>{data.description}</p>}
        </div>
      )}
      <figcaption className="mt-2 text-center text-sm text-muted-foreground">{data.caption}</figcaption>
    </figure>
  )
}
