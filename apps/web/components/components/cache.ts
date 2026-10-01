'use client'

import { useQuery } from '@tanstack/react-query'
import type { ComponentDocumentRef } from '../../lib/components/types'
import { cacheFileUrl, componentAssetsDir } from '../../lib/components/urls'
import { queryKeys } from '../../lib/query-keys'

export type ComponentCacheState =
  | { phase: 'loading' }
  | { phase: 'notComputed' }
  | { phase: 'ready'; value: Record<string, unknown> }
  | { phase: 'error'; message: string }

export function componentCacheQueryKey(doc: ComponentDocumentRef, id: string): readonly unknown[] {
  const cachePath = `${componentAssetsDir(doc.path)}/${id}.json`
  return queryKeys.docAsset(doc.project, doc.host ?? null, cachePath)
}

export function useComponentCache(doc: ComponentDocumentRef, id: string): ComponentCacheState {
  const query = useQuery({
    queryKey: componentCacheQueryKey(doc, id),
    queryFn: async (): Promise<Record<string, unknown> | null> => {
      const response = await fetch(cacheFileUrl(doc, id), { cache: 'no-store' })
      if (response.status === 404) return null
      if (!response.ok) throw new Error(`cache request failed (${response.status})`)
      const value: unknown = await response.json()
      if (value === null || typeof value !== 'object' || Array.isArray(value)) {
        throw new Error('cache file is not a JSON object')
      }
      return value as Record<string, unknown>
    },
  })
  if (query.isPending) return { phase: 'loading' }
  if (query.isError) return { phase: 'error', message: query.error.message }
  if (query.data === null) return { phase: 'notComputed' }
  return { phase: 'ready', value: query.data }
}
