// @memon/core — public API surface
//
// Re-exports types, parsers, serializers. Discovery, polling, log tail, and
// config loaders are added by phases 3-5.

export * from './types.js'
export * from './status.js'
export { parseReadme } from './readme/parse.js'
export { reserializeReadme, serializeReadme } from './readme/serialize.js'
export { parseArtifacts } from './readme/artifacts.js'
export { splitH2Sections } from './readme/sections.js'
export { parseHypotheses } from './hypotheses/parse.js'
export { parseJournal } from './journal/parse.js'
export {
  formatJournalEvent,
  reserializeJournal,
  serializeJournal,
} from './journal/serialize.js'
export { appendJournalEvent, updateLastDigestAt } from './journal/append.js'
export { discoverExperiments, mergeExcludes } from './discovery/discover.js'
export { readExperimentDir } from './discovery/read.js'
export { ExperimentIndex } from './discovery/index.js'
export type { ListFilter, SearchScope } from './discovery/index.js'
export { Poller } from './discovery/poller.js'
export type { PollerCallback, PollerOptions } from './discovery/poller.js'
export {
  DEFAULT_STALE_THRESHOLD_MS,
  isStaleRunning,
  staleAgeMs,
} from './discovery/stale.js'
export type { StaleCheckOptions } from './discovery/stale.js'

export const VERSION = '0.0.0'
