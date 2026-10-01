// project-file-store — public surface of the Project file store. No logic
// lives here; see `../project-file-store.ts` for the module overview.

export { configureProjectFileCache, type FileCacheOptions } from '../project-file-cache.js'
export {
  FILE_OPERATION_REASONS,
  type FileOperationReason,
  onProjectFilesChanged,
  type ProjectFileContext,
  type ProjectFilesChangedListener,
} from '../project-file-context.js'
export type { FileAccessOptions } from '../types.js'
export {
  DEFAULT_FILE_ACCESS_OPTIONS,
  type FileOperationCounters,
  type FileOperationGroupState,
  type FileOperationLatency,
  type FileOperationMetrics,
  type FileOperationName,
  type FileOperationOrigin,
  type FileOperationSeries,
  isHumanFileOperationReason,
  type ProjectFileStatus,
  parseFileOperationReason,
} from './contract.js'
export { projectFs } from './fs-facade.js'
export {
  configureProjectFileStore,
  getFileOperationMetrics,
  getProjectFileAccessOptions,
  getProjectFileContext,
  getProjectFileStatus,
  invalidateProjectFile,
  withProjectFileContext,
} from './runtime.js'
