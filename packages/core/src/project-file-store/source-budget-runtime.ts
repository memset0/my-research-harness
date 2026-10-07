import { getProjectFileContext } from '../project-file-context.js'
import { type SourceBudgetPool, sourceBudgetTiming } from './budgets.js'
import { monotonic } from './clock.js'
import type { FileOperationName } from './contract.js'
import { getStore } from './runtime.js'

export function sourceBudgets(): SourceBudgetPool {
  return getStore().budgets
}
export async function budgetedSourceOperation<T>(
  group: string,
  root: string,
  reservedBytes: number,
  work: () => Promise<T>,
  actualBytes: (result: T) => number = () => 0,
  pool: SourceBudgetPool = sourceBudgets(),
  operation: FileOperationName = 'readFile',
  applicationBytes: (result: T) => number = actualBytes,
): Promise<T> {
  const context = getProjectFileContext()
  const automatic = !context?.reason || ['automatic', 'heartbeat'].includes(context.reason)
  const enqueued = monotonic()
  const scheduled = sourceBudgetTiming() !== undefined
  const finish = await pool.reserve(group, root, reservedBytes, automatic, operation)
  const started = monotonic()
  try {
    const result = await work()
    finish(actualBytes(result))
    if (!scheduled)
      pool.recordUnscheduledOperation(group, operation, automatic, {
        waitMs: started - enqueued,
        execMs: monotonic() - started,
        bytes: applicationBytes(result),
        error: false,
      })
    return result
  } catch (error) {
    // A failed/aborted reply may already have consumed the reserved source bytes.
    finish(reservedBytes)
    if (!scheduled)
      pool.recordUnscheduledOperation(group, operation, automatic, {
        waitMs: started - enqueued,
        execMs: monotonic() - started,
        bytes: 0,
        error: true,
      })
    throw error
  }
}
