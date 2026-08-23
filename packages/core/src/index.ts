// @memon/core — public API surface
//
// Re-exports types, parsers, serializers. Discovery, polling, log tail, and
// config loaders are added by phases 3-5.

export * from './types.js'
export * from './status.js'
export {
  ID_MAX,
  ID_MIN,
  ID_PREFIXES,
  ID_REGEX,
  ID_WIDTH,
  isId,
  padId,
  parseId,
} from './ids.js'
export type { IdPrefix, ParsedId } from './ids.js'
export { parseReadme } from './readme/parse.js'
export { reserializeReadme, serializeReadme } from './readme/serialize.js'
export { parseArtifacts } from './readme/artifacts.js'
export { splitH2Sections } from './readme/sections.js'
export type { H2SectionEntry, SectionSplit } from './readme/sections.js'
export { extractTitle } from './readme/title.js'
export {
  deriveCompletion,
  parseCodeReview,
  splitCodeReviewFrontmatter,
  toggleCommitReviewed,
  toggleTodoDone,
} from './code-review/parse.js'
export type { ParsedCodeReview, SplitCodeReview } from './code-review/parse.js'
export { parseGithubPermalink, sliceContext } from './git/github-permalink.js'
export type { GithubPermalink, PreviewLine, CodeContext } from './git/github-permalink.js'
export {
  applyWarningOp,
  findWarningsSectionRange,
  generateRowId,
  parseWarningsBody,
  renderWarningsBody,
  serializeWarningRow,
  WARNING_CATEGORIES,
  WARNING_STATUS_VALUES,
  WarningOpError,
} from './readme/warnings.js'
export type {
  ApplyWarningOpResult,
  ParsedWarnings,
  SectionRange as WarningsSectionRange,
  Warning,
  WarningCategory,
  WarningOp,
  WarningStatus,
} from './readme/warnings.js'
export { parseHypotheses, parseExperimentRefList } from './hypotheses/parse.js'
export { parseJournal } from './journal/parse.js'
export {
  formatJournalEvent,
  reserializeJournal,
  serializeJournal,
} from './journal/serialize.js'
export { appendJournalEvent, updateLastDigestAt } from './journal/append.js'
export {
  ARCHIVED_SIDECAR,
  discoverRuns,
  isArchived,
  isArchivedSidecar,
  mergeExcludes,
  runArchivedFromRun,
} from './discovery/discover.js'
export {
  archiveRun,
  ArchiveRunningForbiddenError,
  setRunArchived,
  unarchiveRun,
} from './discovery/archive.js'
export type { ArchiveResult } from './discovery/archive.js'
export {
  migrateV3ToV4,
  rewriteV3ExpDoc,
  rewriteV3RunReadme,
} from './migrations/v3-to-v4.js'
export type {
  MigrateV3ToV4Options,
  MigrateV3ToV4Result,
  MigrateV3ToV4Stat,
  RewriteV3ExpInput,
  RewriteV3ExpResult,
  RewriteV3RunInput,
  RewriteV3RunResult,
} from './migrations/v3-to-v4.js'
export { readRunDir } from './discovery/read.js'
export { RunIndex } from './discovery/index.js'
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
export {
  CONFIG_EXAMPLE_BASENAME,
  isProtectedExampleConfigPath,
} from './config/path-policy.js'
export {
  formatRunStamp,
  formatIsoLocal,
  parseSlugFromRunDir,
  parseTimestampFromRunDir,
} from './time.js'
export { FS_CONVENTION_VERSION } from './version.js'
export { nextExperimentId, resolveExperimentId } from './experiments/id.js'
export { parsePorcelainV2, readGitStatus } from './git/status.js'
export type { GitStatus, ReadGitStatusOptions } from './git/status.js'
export {
  MAX_DIFF_BYTES,
  parsePorcelainV2WithFiles,
  readGitFileContents,
  readGitStatusFiles,
} from './git/files.js'
export type {
  GitFileEntry,
  GitFileRef,
  GitFileStatus,
  GitStatusFiles,
  ReadGitFileContentsOptions,
  ReadGitFileContentsResult,
  ReadGitStatusFilesOptions,
} from './git/files.js'
export {
  parseDiffTreeNameStatus,
  parseDiffTreeRaw,
  readGitBranches,
  readGitCommit,
  readGitLog,
  readGitRange,
} from './git/history.js'
export {
  COMMIT_MARKS_RELPATH,
  COMMIT_MARK_STATUSES,
  deleteCommitMark,
  parseCsv as parseCommitMarksCsv,
  readCommitMarks,
  serializeCsv as serializeCommitMarksCsv,
  setCommitMark,
} from './git/commit-marks.js'
export { readGitSubmodules } from './git/submodules.js'
export type {
  GitSubmoduleEntry,
  GitSubmodules,
  ReadGitSubmodulesOptions,
} from './git/submodules.js'
export type {
  CommitMark,
  CommitMarkStatus,
  ReadCommitMarksOptions,
  ReadCommitMarksResult,
} from './git/commit-marks.js'
export type {
  GitBranchEntry,
  GitBranches,
  GitCommitDetail,
  GitCommitSummary,
  GitLog,
  GitRange,
  ReadGitHistoryOptions,
} from './git/history.js'

// v3 experiment doc types (sed-renamed from Experiment* during rename pass)
export type {
  Experiment,
  ExperimentEffectiveTimes,
  ExperimentFrontMatter,
  ExperimentSections,
  ExperimentWarningRecord,
  ExperimentMembershipAnomaly,
  ExperimentMembershipAnomalyCode,
} from './types.js'
export { EXPERIMENT_DIR_REGEX, EXPERIMENT_FILENAME_REGEX } from './types.js'
export { ExperimentFrontMatterRawSchema } from './schemas.js'
export type { ExperimentFrontMatterRaw } from './schemas.js'
export { CodeReviewFrontMatterRawSchema } from './schemas.js'
export type { CodeReviewFrontMatterRaw } from './schemas.js'

// v3 experiment-doc parser / serializer / discovery / membership
export { parseExperimentReadme, buildExperimentRecord } from './experiments/parse.js'
export type { ParsedExperiment } from './experiments/parse.js'
export { serializeExperimentReadme } from './experiments/serialize.js'
export type { SerializeExperimentInput } from './experiments/serialize.js'
export {
  CANONICAL_EXPERIMENT_SECTION_HEADINGS,
  EXPERIMENT_YAML_SCHEMA_VERSIONS,
  IMPLEMENTATION_SCHEMA_VERSION,
  INVESTIGATION_SCHEMA_VERSION,
  MANAGED_DOCUMENT_FILE_NAMES,
  MANAGED_EXPERIMENT_SECTIONS,
  MANAGED_SECTION_HEADINGS,
  MANAGED_SECTION_POINTERS,
  RESULTS_SCHEMA_VERSION,
  emptyImplementationDocument,
  emptyInvestigationDocument,
  emptyResultsDocument,
  lintExperimentDocument,
  parseImplementationYaml,
  parseInvestigationYaml,
  parseResultsYaml,
  readExperimentManagedDocuments,
  renderExperimentManagedSection,
  renderImplementationMarkdown,
  renderInvestigationMarkdown,
  renderManagedDocumentMarkdown,
  renderResultsMarkdown,
  serializeImplementationYaml,
  serializeInvestigationYaml,
  serializeResultsYaml,
  validateExperimentManagedDocuments,
} from './experiments/documents.js'
export type {
  ExperimentDocumentDiagnostic,
  RenderManagedSectionResult,
  ResultsRenderContext,
  ResultsRunLink,
} from './experiments/documents.js'
export { discoverExperiments, readExperimentDoc } from './experiments/discover.js'
export type { DiscoverExperimentsResult } from './experiments/discover.js'
export { computeMembership } from './experiments/membership.js'
export type { MembershipInput, MembershipResult } from './experiments/membership.js'
export { renameExperiment, RenameExperimentError } from './experiments/rename.js'
export type {
  RenameExperimentOptions,
  RenameExperimentResult,
  RenameExperimentWarning,
} from './experiments/rename.js'

export {
  computeFsVersionStatus,
  FsVersionSchemaError,
  readFsVersion,
  resolveVersionFilePath,
  validateFsVersionRecord,
  writeFsVersion,
} from './fs-version/index.js'
export type { FsVersionRecord, FsVersionStatus } from './fs-version/index.js'

export {
  addShare,
  AmbiguousShareError,
  emptySharesFile,
  listShares,
  parseDuration,
  readShares,
  resolveSharesFilePath,
  revokeShare,
  ShareNotFoundError,
  ShareStoreError,
  validateShare,
  writeShares,
} from './shares/index.js'
export type {
  AddShareOptions,
  RevokeShareOptions,
  ShareRecord,
  SharesFile,
} from './shares/index.js'

// CLI helpers (callable from the @memon/cli package and from skills written
// in TypeScript that link directly against @memon/core).
export { CliContextError, loadCliContext } from './cli/context.js'
export type { LoadCliContextInput, LoadCliContextResult } from './cli/context.js'
export { ScanError, scanProjectRoot } from './cli/scan.js'
export type { IndexedRun, ProjectSnapshot, ScanOptions } from './cli/scan.js'
export { runDoctor } from './cli/doctor.js'
export type {
  DoctorIssue,
  DoctorOptions,
  DoctorReport,
  IssueCode,
  IssueSeverity,
} from './cli/doctor.js'

export const VERSION = '0.0.0'
