// Custom logic component (not shadcn). Displays an experiment Status with the
// canonical emoji + an optional ⚠ marker for stale RUNNING.

import type { Status } from '@memon/core'

// Inlined to avoid pulling Node-only modules (fast-glob, fs) into the client
// bundle through @memon/core's barrel export. Mirrors @memon/core's STATUS_EMOJI.
const STATUS_EMOJI: Readonly<Record<Status, string>> = {
  PENDING: '📝',
  RUNNING: '🟢',
  FINISHED: '✅',
  FAILED: '❌',
  UNKNOWN: '❓',
}

export function StatusPill({ status, stale }: { status: Status; stale?: boolean }) {
  return (
    <span className="inline-flex items-center gap-1.5 font-mono text-xs">
      <span aria-hidden>{STATUS_EMOJI[status]}</span>
      <span className="font-semibold tracking-tight">{status}</span>
      {stale && (
        <span title="No directory activity for over an hour" aria-label="stale" className="text-amber-600">
          ⚠
        </span>
      )}
    </span>
  )
}
