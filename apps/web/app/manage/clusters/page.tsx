// /manage/clusters — admin-only (access_clusters) overview of registered compute nodes and GPUs.

import { notFound } from 'next/navigation'
import { ClusterDashboard } from '../../../components/cluster-dashboard'
import { readIdentityFromHeaders } from '../../../lib/server/auth/request-context'
import { canAccessClusters } from '../../../lib/server/cluster/access'

export const metadata = {
  title: 'Clusters — memon',
}

export const dynamic = 'force-dynamic'

export default async function ClustersPage() {
  if (!canAccessClusters(await readIdentityFromHeaders())) notFound()
  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-2 p-3 md:p-4">
        <ClusterDashboard />
      </div>
    </div>
  )
}
