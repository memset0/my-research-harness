// FS v8 derived index: a rebuildable, fingerprint-validated cache of Run,
// Experiment and wiki summaries under `.memon/index/`. Never a source of truth.

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
