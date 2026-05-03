// Status displays. Spec (web-layout / "Status display uses colored Badge"):
// run + hypothesis status render as a colored shadcn Badge with a lucide
// icon. The on-disk emoji ( 🟢 ✅ ❌ … ) is never rendered in the UI.

import type { Status } from '@memon/core'
import {
  AlertTriangle,
  CheckCircle2,
  Circle,
  CircleDot,
  CircleSlash,
  Clock,
  HelpCircle,
  Loader2,
  XCircle,
  type LucideIcon,
} from 'lucide-react'
import { Badge } from './ui/badge'
import { cn } from '../lib/utils'

const STATUS_ICON: Readonly<Record<Status, LucideIcon>> = {
  PENDING: Clock,
  RUNNING: Loader2,
  FINISHED: CheckCircle2,
  FAILED: XCircle,
  UNKNOWN: HelpCircle,
}

const STATUS_CLASS: Readonly<Record<Status, string>> = {
  PENDING:
    'border-slate-300 bg-slate-50 text-slate-700 dark:border-slate-700/40 dark:bg-slate-900/40 dark:text-slate-300',
  RUNNING:
    'border-sky-300 bg-sky-50 text-sky-800 dark:border-sky-700/40 dark:bg-sky-950/40 dark:text-sky-200',
  FINISHED:
    'border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-700/40 dark:bg-emerald-950/40 dark:text-emerald-200',
  FAILED:
    'border-red-300 bg-red-50 text-red-800 dark:border-red-700/40 dark:bg-red-950/40 dark:text-red-200',
  UNKNOWN: 'border-muted-foreground/30 bg-muted text-muted-foreground',
}

export function StatusPill({
  status,
  stale,
  className,
}: {
  status: Status
  stale?: boolean
  className?: string
}) {
  const Icon = STATUS_ICON[status]
  return (
    <span className={cn('inline-flex items-center gap-1', className)}>
      <Badge variant="outline" className={cn('gap-1 font-medium', STATUS_CLASS[status])}>
        <Icon
          className={cn('size-3', status === 'RUNNING' && 'animate-spin')}
          aria-hidden
        />
        {status}
      </Badge>
      {stale && (
        <AlertTriangle
          className="size-3.5 text-amber-600 dark:text-amber-400"
          aria-label="stale (no recent directory activity)"
        />
      )}
    </span>
  )
}

// ---------- Hypothesis status ----------

type HypothesisStatus = 'CONFIRMED' | 'REFUTED' | 'PARTIAL' | 'OPEN' | 'DEFERRED'

const HYP_STATUS_ICON: Readonly<Record<HypothesisStatus, LucideIcon>> = {
  CONFIRMED: CheckCircle2,
  REFUTED: XCircle,
  PARTIAL: CircleDot,
  OPEN: Circle,
  DEFERRED: CircleSlash,
}

const HYP_STATUS_CLASS: Readonly<Record<HypothesisStatus, string>> = {
  CONFIRMED:
    'border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-700/40 dark:bg-emerald-950/40 dark:text-emerald-200',
  REFUTED:
    'border-red-300 bg-red-50 text-red-800 dark:border-red-700/40 dark:bg-red-950/40 dark:text-red-200',
  PARTIAL:
    'border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-700/40 dark:bg-amber-950/40 dark:text-amber-200',
  OPEN: 'border-sky-300 bg-sky-50 text-sky-800 dark:border-sky-700/40 dark:bg-sky-950/40 dark:text-sky-200',
  DEFERRED: 'border-muted-foreground/30 bg-muted text-muted-foreground',
}

export function HypothesisStatusPill({
  status,
  className,
}: {
  status: HypothesisStatus
  className?: string
}) {
  const Icon = HYP_STATUS_ICON[status]
  return (
    <Badge
      variant="outline"
      className={cn('gap-1 font-medium', HYP_STATUS_CLASS[status], className)}
    >
      <Icon className="size-3" aria-hidden />
      {status}
    </Badge>
  )
}
