'use client'

import { useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { toast } from 'sonner'
import { ApiError, type ProjectTarget, patchExperimentStatus, projectQueryKey } from '../lib/api'
import { StatusPill } from './status-pill'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select'
import { ViewerGuard } from './viewer-guard'

// All v4 status values, used as the type for the incoming `status` prop
// (since the on-disk value CAN be UNKNOWN even though the picker doesn't
// offer it as user-selectable).
type Status = 'PENDING' | 'RUNNING' | 'FINISHED' | 'INTERRUPTED' | 'FAILED' | 'UNKNOWN'

// v4: picker excludes UNKNOWN — it's parser-only per archive-frontmatter /
// experiment-readme spec.
const SELECTABLE_STATUS_VALUES = [
  'PENDING',
  'RUNNING',
  'FINISHED',
  'INTERRUPTED',
  'FAILED',
] as const

export function StatusEdit({
  id,
  project,
  status,
  stale,
  expectedMtime,
}: {
  id: string
  project?: ProjectTarget
  status: Status
  stale?: boolean
  expectedMtime: number
}) {
  const [busy, setBusy] = useState(false)
  const queryClient = useQueryClient()
  const projectKey = project ? projectQueryKey(project) : []

  const onChange = async (next: string) => {
    if (next === status) return
    setBusy(true)
    try {
      const res = await patchExperimentStatus({
        ...(project ? { project } : {}),
        id,
        status: next,
        expectedMtime,
      })
      if ('error' in res && res.error?.code === 'CONFLICT') {
        toast.error(`Status change conflicted (someone else just edited this README)`, {
          description: 'Reload to see the latest content, then try again.',
          action: {
            label: 'Reload',
            onClick: () => queryClient.invalidateQueries({ queryKey: ['run', ...projectKey, id] }),
          },
        })
      } else if ('error' in res && res.error?.code === 'ARCHIVE_RUNNING_FORBIDDEN') {
        // v4 hard rule: cannot transition to RUNNING on an archived run.
        toast.error(`Cannot set RUNNING on an archived run`, {
          description: 'Unarchive first, then change the status.',
        })
      } else if ('mtime' in res) {
        toast.success(`Status: ${status} → ${next}`)
        // v4: soft warning when modifying archived material.
        if ('warning' in res && res.warning === 'archived') {
          toast.warning(`${id} is archived; modifying anyway`)
        }
        queryClient.invalidateQueries({ queryKey: ['run', ...projectKey, id] })
        queryClient.invalidateQueries({ queryKey: ['runs', ...projectKey] })
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
        <ViewerGuard reason="Change status">
          <SelectTrigger size="sm" className="h-7 w-[8rem] text-xs" aria-label="Change status">
            <SelectValue />
          </SelectTrigger>
        </ViewerGuard>
        <SelectContent>
          {SELECTABLE_STATUS_VALUES.map((s) => (
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
