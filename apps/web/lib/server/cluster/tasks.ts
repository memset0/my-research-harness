import 'server-only'
import type { ClusterTaskDto } from '@/lib/dto/clusters'
import { getAccountStore } from '@/lib/server/account-store'
import type { RequestIdentity } from '@/lib/server/auth/request-context'
import { getTicketBroker } from '@/lib/server/gpu-pool/broker'
import type { HerdrTerminal } from '@/lib/server/gpu-pool/herdr'
import { getRuntime } from '@/lib/server/runtime'
import { mapTasks, visibilityFor } from './task-view'

const TERMINALS_TTL_MS = 15_000
let terminalsCache: { at: number; value: Map<string, HerdrTerminal[]> } | null = null

/** GPU tickets for the cluster timeline, filtered to what `identity` may see. */
export async function listTasks(identity: RequestIdentity): Promise<ClusterTaskDto[] | null> {
  const runtime = await getRuntime()
  const broker = getTicketBroker(runtime.configPath)
  broker.start()
  const account = identity.account
  const granted =
    !account || account.level === 'super_admin'
      ? ('all' as const)
      : ((await (await getAccountStore(runtime.configPath, runtime.auth.username)).byId(account.id))
          ?.adminProjects ?? [])
  const now = Date.now()
  if (!terminalsCache || now - terminalsCache.at > TERMINALS_TTL_MS) {
    const value = await broker.ticketTerminals().catch(() => terminalsCache?.value ?? new Map())
    terminalsCache = { at: now, value }
  }
  return mapTasks(await broker.list(), terminalsCache.value, visibilityFor(granted), now)
}
