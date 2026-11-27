// /manage/traffic — Traffic control, owner-only (`configure_instance`):
// network measurements of forwarded service traffic and probes, then the
// central filesystem scheduler's settings and metrics (formerly File access).
//
// Both panels are client components; the route itself renders no project data
// and touches no files.

import { notFound } from 'next/navigation'
import { FileAccessSettingsPanel } from '../../../components/file-access-settings-panel'
import { TrafficNetworkPanel } from '../../../components/traffic-network-panel'
import { levelCan } from '../../../lib/server/auth/capabilities'
import { readAccountFromHeaders } from '../../../lib/server/auth/request-context'

export const metadata = {
  title: 'Traffic control — memon',
}

export const dynamic = 'force-dynamic'

export default async function TrafficControlPage() {
  if (!levelCan((await readAccountFromHeaders())?.level, 'configure_instance')) notFound()
  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div
        className="mx-auto flex w-full max-w-7xl flex-col gap-3 p-3 md:p-4"
        data-slot="traffic-control"
      >
        <h1 className="text-sm font-medium">Traffic control</h1>
        <TrafficNetworkPanel />
        <FileAccessSettingsPanel />
      </div>
    </div>
  )
}
