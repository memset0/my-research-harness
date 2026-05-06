'use client'

import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { ApiError, patchExperimentStatus } from '../lib/api'
import { StatusPill } from './status-pill'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from './ui/select'

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

  const onChange = async (next: string) => {
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
            onClick: () => queryClient.invalidateQueries({ queryKey: ['run', id] }),
          },
        })
      } else if ('mtime' in res) {
        toast.success(`Status: ${status} → ${next}`)
        queryClient.invalidateQueries({ queryKey: ['run', id] })
        queryClient.invalidateQueries({ queryKey: ['runs'] })
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
      <Select value={status} disabled={busy} onValueChange={(v) => void onChange(v)}>
        <SelectTrigger size="sm" className="h-7 w-[8rem] text-xs" aria-label="Change status">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {STATUS_VALUES.map((s) => (
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
