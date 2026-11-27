import 'server-only'
import type { ClusterTaskDto } from '@/lib/dto/clusters'
import type { RequestIdentity } from '@/lib/server/auth/request-context'
import { getTicketBroker } from '@/lib/server/gpu-pool/broker'
import type { HerdrTerminal } from '@/lib/server/gpu-pool/herdr'
import { getRuntime } from '@/lib/server/runtime'
import { mapTasks, visibilityFor } from './task-view'

const TERMINALS_TTL_MS = 15_000
let terminalsCache: { at: number; value: Map<string, HerdrTerminal[]> } | null = null

/** GPU tickets for the cluster timeline (callers hold `access_clusters`). */
export async function listTasks(_identity: RequestIdentity): Promise<ClusterTaskDto[] | null> {
  const runtime = await getRuntime()
  const broker = getTicketBroker(runtime.configPath)
  broker.start()
  // Every caller that reaches this (access_clusters) is an admin or the super admin,
  // and admins reach every Project, so tickets are shown in full.
  const granted = 'all' as const
  const now = Date.now()
  if (!terminalsCache || now - terminalsCache.at > TERMINALS_TTL_MS) {
    const value = await broker.ticketTerminals().catch(() => terminalsCache?.value ?? new Map())
    terminalsCache = { at: now, value }
  }
  return mapTasks(await broker.list(), terminalsCache.value, visibilityFor(granted), now)
}
