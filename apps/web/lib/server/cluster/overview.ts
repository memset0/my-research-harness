import 'server-only'
import { loadNodes, nodesConfigPath } from '@memon/core'
import type { ClusterOverviewDto } from '@/lib/dto/clusters'
import { buildOverview, createProbeCache } from './probe'
import { listTasks } from './tasks'

// One cache per server process so concurrent page polls share probes.
const probe = createProbeCache()

export async function getClusterOverview(refresh: boolean): Promise<ClusterOverviewDto> {
  const nodes = await loadNodes(nodesConfigPath())
  return buildOverview(nodes, probe, { refresh, nowMs: Date.now(), tasks: await listTasks() })
}
