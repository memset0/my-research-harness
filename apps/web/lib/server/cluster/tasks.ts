import 'server-only'
import type { ClusterTaskDto } from '@/lib/dto/clusters'

/**
 * Ticket-driven tasks for the cluster timeline. `null` means no task source is
 * configured; the ticket change replaces this implementation.
 */
export async function listTasks(): Promise<ClusterTaskDto[] | null> {
  return null
}
