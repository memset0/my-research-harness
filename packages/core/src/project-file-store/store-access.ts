// project-file-store/store-access — the narrow view of the process-global
// store that modules below `store.ts` need. `runtime.ts` installs the
// accessor, so those modules import neither the store nor the runtime and the
// module graph stays acyclic.

import type { FileAccessOptions } from '../types.js'
import type { SourceBudgetPool } from './budgets.js'

export interface StoreAccess {
  readonly budgets: SourceBudgetPool
  effectiveOptions(): FileAccessOptions
  recordTransport(group: string, operation: string, bytes: number, validation: boolean): void
  noteAuthority(root: string, identity: string): void
}

let accessor: (() => StoreAccess) | null = null

export function installStoreAccess(get: () => StoreAccess): void {
  accessor = get
}

export function storeAccess(): StoreAccess {
  if (accessor === null) throw new Error('the project file store runtime is not loaded')
  return accessor()
}
