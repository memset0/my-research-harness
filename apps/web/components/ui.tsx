// Minimal shadcn-flavored primitives without pulling in the full library.
// Intentionally kept simple — these cover the visual vocabulary we need
// (button, badge, card, status pill) and nothing else.

import { cn } from '../lib/utils'
import type { Status } from '@memon/core'

// Inlined to avoid pulling Node-only modules (fast-glob, fs) into the client bundle
// through @memon/core's barrel export. These mirror @memon/core's STATUS_EMOJI exactly.
const STATUS_EMOJI: Readonly<Record<Status, string>> = {
  PENDING: '📝',
  RUNNING: '🟢',
  FINISHED: '✅',
  FAILED: '❌',
  UNKNOWN: '❓',
}

export function Button({
  className,
  variant = 'default',
  size = 'default',
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'default' | 'outline' | 'ghost'
  size?: 'default' | 'sm'
}) {
  return (
    <button
      className={cn(
        'inline-flex items-center justify-center gap-2 rounded-md text-sm font-medium transition focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50',
        size === 'sm' ? 'h-8 px-3' : 'h-9 px-4',
        variant === 'default' && 'bg-slate-900 text-white hover:bg-slate-800',
        variant === 'outline' &&
          'border border-slate-300 bg-white text-slate-900 hover:bg-slate-100',
        variant === 'ghost' && 'text-slate-700 hover:bg-slate-100',
        className,
      )}
      {...props}
    />
  )
}

export function Card({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn('rounded-lg border border-slate-200 bg-white shadow-sm', className)}
      {...props}
    />
  )
}

export function CardHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('flex flex-col gap-1 p-4 border-b border-slate-100', className)} {...props} />
}

export function CardTitle({ className, ...props }: React.HTMLAttributes<HTMLHeadingElement>) {
  return <h3 className={cn('text-base font-semibold tracking-tight', className)} {...props} />
}

export function CardContent({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('p-4', className)} {...props} />
}

export function Badge({
  className,
  variant = 'default',
  ...props
}: React.HTMLAttributes<HTMLSpanElement> & {
  variant?: 'default' | 'outline' | 'destructive' | 'success' | 'warning'
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium',
        variant === 'default' && 'bg-slate-100 text-slate-800',
        variant === 'outline' && 'border border-slate-200 text-slate-700',
        variant === 'destructive' && 'bg-red-100 text-red-800',
        variant === 'success' && 'bg-emerald-100 text-emerald-800',
        variant === 'warning' && 'bg-amber-100 text-amber-800',
        className,
      )}
      {...props}
    />
  )
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
