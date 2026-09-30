'use client'

import { useQueryClient } from '@tanstack/react-query'
import { Loader2, RefreshCw } from 'lucide-react'
import { useState } from 'react'
import { runComponents, type ComponentRunResult } from '../../lib/api'
import type { ComponentBlockContext } from '../../lib/components/types'
import { Button } from '../ui/button'
import { useIsOwner } from '../session-provider'
import { componentCacheQueryKey } from './cache'

type RecomputeState =
  | { phase: 'idle' }
  | { phase: 'pending' }
  | { phase: 'updated' | 'unchanged' }
  | { phase: 'failed'; message: string }

export function RecomputeButton({ block }: { block: ComponentBlockContext }) {
  const owner = useIsOwner()
  const queryClient = useQueryClient()
  const [state, setState] = useState<RecomputeState>({ phase: 'idle' })
  if (!block.executable || !block.document || !block.id || !owner) return null

  const run = async () => {
    setState({ phase: 'pending' })
    try {
      const response = await runComponents(
        block.document!.host
          ? { host: block.document!.host, project: block.document!.project }
          : block.document!.project,
        { document: block.document!.path, ids: [block.id!] },
      )
      const result: ComponentRunResult | undefined = response.results.find(
        (item) => item.id === block.id,
      )
      if (!result) throw new Error(`run response did not include ${block.id}`)
      if (result.status === 'failed') {
        setState({ phase: 'failed', message: result.error ?? 'component run failed' })
        return
      }
      await queryClient.invalidateQueries({
        queryKey: componentCacheQueryKey(block.document!, block.id!),
      })
      setState({ phase: result.status })
    } catch (cause) {
      setState({ phase: 'failed', message: cause instanceof Error ? cause.message : String(cause) })
    }
  }

  const label =
    state.phase === 'pending' ? 'recomputing' : state.phase === 'idle' ? 'recompute' : state.phase
  return (
    <div
      className="flex flex-wrap items-center gap-2 text-xs"
      data-component-recompute={state.phase}
    >
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={state.phase === 'pending'}
        onClick={run}
      >
        {state.phase === 'pending' ? (
          <Loader2 className="animate-spin" aria-hidden />
        ) : (
          <RefreshCw aria-hidden />
        )}
        {label}
      </Button>
      {state.phase === 'failed' && (
        <span role="alert" className="text-destructive">
          {state.message}
        </span>
      )}
    </div>
  )
}
