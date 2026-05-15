import { AlertTriangle } from 'lucide-react'
import { cn } from '../lib/utils'

export type StaleReason = 'unknown-project' | 'unknown-target'

export function StaleBanner({
  reason,
  sessionName,
  className,
}: {
  reason: StaleReason
  sessionName: string
  className?: string
}) {
  return (
    <div
      className={cn(
        'flex shrink-0 items-center gap-2 px-3 py-1.5 text-[11px]',
        'bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-200',
        className,
      )}
      role="status"
      aria-live="polite"
    >
      <AlertTriangle className="size-3 shrink-0" aria-hidden />
      <span className="shrink-0">
        Stale: {reason} — memon links won&rsquo;t resolve. ttyd is still attached.
      </span>
      <span className="ml-auto min-w-0 truncate font-mono">{sessionName}</span>
    </div>
  )
}
