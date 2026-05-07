// /manage/tmux — host-level inventory of `memon-*` tmux sessions.
//
// Server component: prefetches the session list via direct runtime call
// (no HTTP round-trip during SSR) and dehydrates into TanStack Query for
// the client component to read.

import { HydrationBoundary, dehydrate } from '@tanstack/react-query'
import { getQueryClient } from '../../../lib/get-query-client'
import { getRuntime } from '../../../lib/runtime'
import { listMemonTmuxSessions } from '../../../lib/terminal/tmux-discover'
import { TmuxManagePageClient } from './tmux-page.client'

export const dynamic = 'force-dynamic'

export default async function TmuxManagePage() {
  const rt = await getRuntime()
  const sessions = await listMemonTmuxSessions(rt)

  const qc = getQueryClient()
  qc.setQueryData(['tmux-sessions'], { sessions })

  return (
    <div className="mx-auto max-w-[1400px] p-6">
      <HydrationBoundary state={dehydrate(qc)}>
        <TmuxManagePageClient />
      </HydrationBoundary>
    </div>
  )
}
