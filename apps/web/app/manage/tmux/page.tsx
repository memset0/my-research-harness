// /manage/tmux — host-level inventory of `memon-*` tmux sessions.
//
// Server component: prefetches the session list via direct runtime call
// (no HTTP round-trip during SSR) and dehydrates into TanStack Query for
// the client component to read.

import { dehydrate, HydrationBoundary } from '@tanstack/react-query'
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { getQueryClient } from '../../../lib/get-query-client'
import { getRuntime } from '../../../lib/runtime'
import { TmuxManagePageClient } from './tmux-page.client'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = { title: 'Tmux' }

export default async function TmuxManagePage() {
  const rt = await getRuntime()
  if (rt.config.terminal.tmuxEnabled === false) notFound()
  const { listMemonTmuxSessions } = await import('../../../lib/terminal/tmux-discover')
  const sessions = await listMemonTmuxSessions(rt)

  const qc = getQueryClient()
  qc.setQueryData(['tmux-sessions'], { sessions })

  return (
    <HydrationBoundary state={dehydrate(qc)}>
      <TmuxManagePageClient />
    </HydrationBoundary>
  )
}
