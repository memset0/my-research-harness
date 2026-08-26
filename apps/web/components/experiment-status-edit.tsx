'use client'

// v4: ExperimentStatus picker. Mirrors `StatusEdit` (run side) but writes
// through the dedicated PATCH /api/experiments/:id/status endpoint.

import { useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { toast } from 'sonner'
import { ApiError, type ProjectTarget, patchExperimentStatusV4, projectQueryKey } from '../lib/api'
import { ExperimentStatusPill } from './status-pill'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select'

type ExperimentStatus = 'OPEN' | 'RESOLVED' | 'ABANDONED'

const SELECTABLE: readonly ExperimentStatus[] = ['OPEN', 'RESOLVED', 'ABANDONED']

export function ExperimentStatusEdit({
  expId,
  project,
  status,
  archived,
  expectedMtime,
}: {
  expId: string
  project?: ProjectTarget
  status: ExperimentStatus
  archived?: boolean
  expectedMtime: number
}) {
  const [busy, setBusy] = useState(false)
  const queryClient = useQueryClient()
  const projectKey = project ? projectQueryKey(project) : []

  const onChange = async (next: string) => {
    if (next === status) return
    if (!SELECTABLE.includes(next as ExperimentStatus)) return
    setBusy(true)
    try {
      const res = await patchExperimentStatusV4({
        ...(project ? { project } : {}),
        id: expId,
        status: next as ExperimentStatus,
        expectedMtime,
      })
      if ('error' in res && res.error?.code === 'CONFLICT') {
        toast.error('Status change conflicted (someone else just edited this doc)', {
          description: 'Reload to see the latest content, then try again.',
          action: {
            label: 'Reload',
            onClick: () =>
              queryClient.invalidateQueries({
                queryKey: ['experiment', ...projectKey, expId],
              }),
          },
        })
      } else if ('mtime' in res) {
        toast.success(`Status: ${status} → ${next}`)
        if ('warning' in res && res.warning === 'archived') {
          toast.warning(`${expId} is archived; modifying anyway`)
        }
        queryClient.invalidateQueries({
          queryKey: ['experiment', ...projectKey, expId],
        })
        queryClient.invalidateQueries({ queryKey: ['experiments', ...projectKey] })
      }
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : (err as Error).message
      toast.error(`Status change failed: ${msg}`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="inline-flex items-center gap-2">
      <ExperimentStatusPill status={status} archived={archived} />
      <Select value={status} disabled={busy} onValueChange={(v) => void onChange(v)}>
        <SelectTrigger
          size="sm"
          className="h-7 w-[8rem] text-xs"
          aria-label="Change experiment status"
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {SELECTABLE.map((s) => (
            <SelectItem key={s} value={s}>
              {s}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {busy && <span className="text-xs text-muted-foreground">saving…</span>}
    </div>
  )
}
