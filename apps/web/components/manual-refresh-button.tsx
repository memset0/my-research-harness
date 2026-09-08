'use client'

// Explicit reload for resources the shared heartbeat deliberately leaves
// alone — today that means Run README bodies and their file listings.
//
// A Run body on screen must not change under the reader when its status
// changes or its parent list refreshes, so the only way to pull new content is
// this button. The body request is tagged as human `manual` demand. Collection
// requests such as the file listing are independently normalized to
// `automatic`, so reloading them never promotes collection work.

import { useQueryClient } from '@tanstack/react-query'
import { RefreshCw } from 'lucide-react'
import { useState } from 'react'
import { withResourceReason } from '../lib/resource-protocol'
import { cn } from '../lib/utils'
import { Button } from './ui/button'

export interface ManualRefreshButtonProps {
  /** Query keys to refetch, in the order they should be requested. */
  queryKeys: ReadonlyArray<readonly unknown[]>
  /** Accessible name; also the tooltip. Defaults to "Refresh from disk". */
  label?: string
  className?: string
}

export function ManualRefreshButton({
  queryKeys,
  label = 'Refresh from disk',
  className,
}: ManualRefreshButtonProps) {
  const queryClient = useQueryClient()
  const [refreshing, setRefreshing] = useState(false)

  const reload = async () => {
    if (refreshing) return
    setRefreshing(true)
    try {
      await withResourceReason('manual', () =>
        Promise.all(queryKeys.map((queryKey) => queryClient.refetchQueries({ queryKey }))),
      )
    } finally {
      setRefreshing(false)
    }
  }

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      disabled={refreshing}
      onClick={() => void reload()}
      aria-label={label}
      title={label}
      data-slot="manual-refresh"
      className={cn(className)}
    >
      <RefreshCw className={cn('size-3.5', refreshing && 'animate-spin')} aria-hidden />
      {refreshing ? 'Refreshing…' : 'Refresh'}
    </Button>
  )
}
