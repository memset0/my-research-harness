/** Compatibility exports: central no longer opens or writes project cache dumps. */
import type { FileCacheOptions } from './types.js'

export type { FileCacheOptions }
export const DEFAULT_DUMP_INTERVAL_MS = 30_000
export const DEFAULT_WIKI_TTL_MS = 30_000
export const DEFAULT_DOCUMENT_TTL_MS = 30_000
export async function configureProjectFileCache(_options?: FileCacheOptions): Promise<void> {}
export function getProjectFileCache(): null {
  return null
}
