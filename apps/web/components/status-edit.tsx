'use client'

import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { ApiError, patchExperimentStatus } from '../lib/api'
import { StatusPill } from './ui'

const STATUS_VALUES = ['PENDING', 'RUNNING', 'FINISHED', 'FAILED', 'UNKNOWN'] as const
type Status = (typeof STATUS_VALUES)[number]

export function StatusEdit({
  id,
  status,
  stale,
  expectedMtime,
}: {
  id: string
  status: Status
  stale?: boolean
  expectedMtime: number
}) {
  const [busy, setBusy] = useState(false)
  const queryClient = useQueryClient()

  const onChange = async (next: Status) => {
    if (next === status) return
    setBusy(true)
    try {
      const res = await patchExperimentStatus({
        id,
        status: next,
        expectedMtime,
      })
      if ('error' in res && res.error?.code === 'CONFLICT') {
        toast.error(`Status change conflicted (someone else just edited this README)`, {
          description: 'Reload to see the latest content, then try again.',
          action: {
            label: 'Reload',
            onClick: () => queryClient.invalidateQueries({ queryKey: ['experiment', id] }),
          },
        })
      } else if ('mtime' in res) {
        toast.success(`Status: ${status} → ${next}`)
        queryClient.invalidateQueries({ queryKey: ['experiment', id] })
        queryClient.invalidateQueries({ queryKey: ['experiments'] })
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
      <StatusPill status={status} stale={stale} />
      <select
        value={status}
        disabled={busy}
        onChange={(e) => void onChange(e.target.value as Status)}
        className="h-7 rounded border border-slate-300 bg-white px-2 text-xs disabled:opacity-50"
        aria-label="Change status"
      >
        {STATUS_VALUES.map((s) => (
          <option key={s} value={s}>
            {s}
          </option>
        ))}
      </select>
      {busy && <span className="text-xs text-slate-500">saving…</span>}
    </div>
  )
}
