// Animated skeleton placeholders. Use these for first-load states; once data
// is in the TanStack Query cache, refetches don't pulse a skeleton.

import { cn } from '../lib/utils'

function Block({ className }: { className?: string }) {
  return (
    <div className={cn('animate-pulse rounded bg-muted', className)} aria-hidden />
  )
}

export function RowSkeleton() {
  return (
    <div className="rounded-lg border bg-card p-3">
      <div className="grid grid-cols-1 gap-2 md:grid-cols-12 md:items-center md:gap-3">
        <Block className="h-4 w-20 md:col-span-2" />
        <Block className="h-4 w-40 md:col-span-3" />
        <Block className="h-4 w-32 md:col-span-2" />
        <Block className="h-4 w-28 md:col-span-2" />
        <Block className="h-4 w-12 md:col-span-1" />
        <Block className="h-4 w-20 md:col-span-2" />
      </div>
    </div>
  )
}

export function ListSkeleton({ count = 5 }: { count?: number }) {
  return (
    <div className="flex flex-col gap-2">
      {Array.from({ length: count }).map((_, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: skeleton order is stable
        <RowSkeleton key={i} />
      ))}
    </div>
  )
}

export function CardSkeleton() {
  return (
    <div className="rounded-lg border bg-card p-4">
      <Block className="mb-3 h-5 w-32" />
      <div className="space-y-2">
        <Block className="h-3 w-full" />
        <Block className="h-3 w-5/6" />
        <Block className="h-3 w-4/6" />
      </div>
    </div>
  )
}

export function DetailSkeleton() {
  return (
    <div className="flex flex-col gap-4 p-4 md:p-6">
      <div className="rounded-lg border bg-card p-4">
        <div className="mb-3 flex items-center gap-2">
          <Block className="h-4 w-24" />
          <Block className="h-4 w-48" />
        </div>
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: stable
            <div key={i} className="space-y-1">
              <Block className="h-2 w-12" />
              <Block className="h-3 w-24" />
            </div>
          ))}
        </div>
      </div>
      <CardSkeleton />
      <CardSkeleton />
      <CardSkeleton />
    </div>
  )
}
