import 'server-only'
import { levelCan } from '@/lib/server/auth/capabilities'
import type { RequestIdentity } from '@/lib/server/auth/request-context'

/** Single gate for the cluster overview: accounts holding `access_clusters` (admin and above). */
export function canAccessClusters(identity: RequestIdentity): boolean {
  // Middleware grants the owner route role only to the super admin.
  if (!identity.account) return identity.role === 'owner'
  return levelCan(identity.account.level, 'access_clusters')
}
