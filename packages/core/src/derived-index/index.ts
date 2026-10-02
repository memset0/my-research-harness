// FS v8 derived index: a rebuildable, fingerprint-validated cache of Run,
// Experiment and wiki summaries under `.memon/index/`. Never a source of truth.

export {
  ABANDONED_TEMPORARY_MS,
  acquireIndexLease,
  COMPACTION_LEASE_MS,
  type CompactIndexOptions,
  type CompactIndexResult,
  type CompactIndexStatus,
  compactIndex,
  type IndexLease,
  type IndexLeaseOptions,
  writeSnapshot,
} from './compact.js'
export {
  type DeriveExperimentEntryInput,
  type DeriveRunEntryInput,
  type DeriveWikiEntryInput,
  deriveExperimentEntry,
  deriveRunEntry,
  deriveWikiEntry,
  type ExperimentLocation,
  experimentLocation,
  indexKey,
  runRowFromRun,
} from './entries.js'
export {
  type AppendIndexEventResult,
  appendIndexEvent,
  INDEX_EVENT_FAILED,
  type IndexEventBody,
  type IndexEventWarning,
  type IndexSink,
} from './events.js'
export {
  type FingerprintSource,
  newestCtime,
  type PersistedFingerprint,
  persistedFingerprint,
  sameFingerprint,
  takeFingerprint,
} from './fingerprint.js'
export { defaultIndexFs, type IndexFs } from './fs.js'
export { ensureIndexDirectory } from './gitignore.js'
export {
  emptySnapshot,
  entryCtime,
  mergeIndexEvents,
  type NamedIndexEvent,
  recomputeOwners,
} from './merge.js'
export {
  classifyIndexedPath,
  type IndexedFileChange,
  type MutationIndexExtras,
  publishMutationEvent,
} from './mutation-events.js'
export {
  EVENT_FILE_REGEX,
  eventFileName,
  eventFileTime,
  INDEX_DIR_RELPATH,
  INDEX_GITIGNORE_CONTENT,
  type IndexPaths,
  isEventFileName,
  isProjectRelativePath,
  resolveIndexPaths,
} from './paths.js'
export {
  auditRunDirs,
  buildIndexSnapshot,
  type RebuildIndexOptions,
  type RebuildIndexResult,
  type RebuildIndexStatus,
  type RunDirsAudit,
  rebuildIndex,
} from './rebuild.js'
export {
  EventSchema,
  type ExperimentIndexEntry,
  type ExperimentRow,
  INDEX_ENTRY_KINDS,
  INDEX_VERSION,
  type IndexEntryKind,
  type IndexEvent,
  type IndexFileVerdict,
  type IndexRole,
  type IndexSnapshot,
  parseEvent,
  parseSnapshot,
  type RunDirsSource,
  type RunIndexEntry,
  type RunRow,
  SnapshotSchema,
  type WikiIndexEntry,
} from './schema.js'
export {
  type DerivedIndexRead,
  listIndexEvents,
  mergedIndexView,
  type ReadIndexOptions,
  readDerivedIndex,
  type SkippedIndexEvent,
  type SnapshotState,
  UNPARSABLE_EVENT_GRACE_MS,
} from './snapshot.js'
export {
  INDEX_DRIFT,
  type IndexDriftRecord,
  type IndexLayoutNotice,
  type IndexWindow,
  layoutNotices,
  RUN_NESTED,
  RUN_OUTSIDE_RUN_DIRS,
  type StaleIndexEntry,
  type ValidateIndexEntriesOptions,
  type ValidateIndexEntriesResult,
  type VerifyIndexOptions,
  type VerifyIndexResult,
  validateIndexEntries,
  verifyIndex,
} from './validate.js'
