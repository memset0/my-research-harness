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
export {
  ARCHIVED_SIDECAR,
  discoverExperiments,
  isArchived,
  mergeExcludes,
} from './discovery/discover.js'
export { archiveExperiment, unarchiveExperiment } from './discovery/archive.js'
export type { ArchiveResult } from './discovery/archive.js'
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
export { DEFAULT_ANCHOR_EVERY, LineIndex } from './log/line-index.js'
export type { AppendResult, LineIndexOptions, LineRange } from './log/line-index.js'
export {
  CACHE_VERSION,
  defaultCacheDir,
  loadCache,
  saveCache,
} from './log/cache.js'
export type { CacheOptions, CacheRecord } from './log/cache.js'
export { ConfigError, implicitCwdProject, loadConfig } from './config/load.js'
export type { LoadConfigOptions } from './config/load.js'
export { formatExperimentStamp, formatIsoLocal } from './time.js'

// CLI helpers (callable from the @memon/cli package and from skills written
// in TypeScript that link directly against @memon/core).
export { CliContextError, loadCliContext } from './cli/context.js'
export type { LoadCliContextInput, LoadCliContextResult } from './cli/context.js'
export { ScanError, scanProjectRoot } from './cli/scan.js'
export type { IndexedExperiment, ProjectSnapshot, ScanOptions } from './cli/scan.js'
export { runDoctor } from './cli/doctor.js'
export type {
  DoctorIssue,
  DoctorOptions,
  DoctorReport,
  IssueCode,
  IssueSeverity,
} from './cli/doctor.js'

export const VERSION = '0.0.0'
