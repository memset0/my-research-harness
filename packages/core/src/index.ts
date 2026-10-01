// @memon/core — public API surface
//
// Re-exports types, parsers, serializers. Discovery, polling, log tail, and
// config loaders are added by phases 3-5.

export type { AtomicWriteFs, WriteFileAtomicOptions } from './atomic-write.js'
export { writeFileAtomic } from './atomic-write.js'
export * from './backend-negotiation.js'
export * from './backend-protocol.js'
export type { ParsedCodeReview, SplitCodeReview } from './code-review/parse.js'
export {
  deriveCompletion,
  parseCodeReview,
  splitCodeReviewFrontmatter,
  toggleCommitReviewed,
  toggleTodoDone,
} from './code-review/parse.js'
export * from './components/index.js'
export type {
  BackendUrlPolicyErrorCode,
  BackendUrlPolicyOptions,
} from './config/backend-url.js'
export {
  BACKEND_URL_POLICY_ERROR_CODES,
  BackendUrlPolicyError,
  isLinkLocalIpLiteral,
  isLoopbackOrPrivateIpLiteral,
  normalizeBackendBaseUrl,
} from './config/backend-url.js'
export type { LoadConfigOptions } from './config/load.js'
export { ConfigError, implicitCwdProject, loadConfig } from './config/load.js'
export {
  CONFIG_EXAMPLE_BASENAME,
  isProtectedExampleConfigPath,
} from './config/path-policy.js'
export {
  assertOwnerOnlyServiceConfig,
  SERVICE_CONFIG_FILE_MODE,
} from './config/permissions.js'
export type { ArchiveResult } from './discovery/archive.js'
export {
  ArchiveRunningForbiddenError,
  archiveRun,
  setRunArchived,
  unarchiveRun,
} from './discovery/archive.js'
export type {
  DeprecationResult,
  ListDeprecatedRunIdsOptions,
  SetRunDeprecatedOptions,
} from './discovery/deprecation.js'
export {
  deprecateRun,
  isRunDeprecated,
  listDeprecatedRunIds,
  RunWriteConflictError,
  setRunDeprecated,
  undeprecateRun,
} from './discovery/deprecation.js'
export {
  ARCHIVED_SIDECAR,
  discoverRuns,
  isArchived,
  isArchivedSidecar,
  mergeExcludes,
  runArchivedFromRun,
} from './discovery/discover.js'
export type { ListFilter, SearchScope } from './discovery/index.js'
export { matchesRunDeprecationFilter, RunIndex } from './discovery/index.js'
export type { PollerCallback, PollerOptions } from './discovery/poller.js'
export { Poller } from './discovery/poller.js'
export { readRunDir } from './discovery/read.js'
export type { StaleCheckOptions } from './discovery/stale.js'
export {
  DEFAULT_STALE_THRESHOLD_MS,
  isStaleRunning,
  staleAgeMs,
} from './discovery/stale.js'
export type { DiscoverExperimentsResult } from './experiments/discover.js'
export {
  discoverExperiments,
  listExperimentIds,
  listExperimentPaths,
  readExperimentDoc,
} from './experiments/discover.js'
export type {
  ExperimentDocumentDiagnostic,
  RenderManagedSectionResult,
  ResultsRenderContext,
  ResultsRunLink,
} from './experiments/documents.js'
export {
  CANONICAL_EXPERIMENT_SECTION_HEADINGS,
  EXPERIMENT_YAML_SCHEMA_VERSIONS,
  emptyImplementationDocument,
  emptyInvestigationDocument,
  emptyResultsDocument,
  IMPLEMENTATION_SCHEMA_VERSION,
  INVESTIGATION_SCHEMA_VERSION,
  lintExperimentDocument,
  MANAGED_DOCUMENT_FILE_NAMES,
  MANAGED_EXPERIMENT_SECTIONS,
  MANAGED_SECTION_HEADINGS,
  MANAGED_SECTION_POINTERS,
  parseImplementationYaml,
  parseInvestigationYaml,
  parseResultsYaml,
  RESULTS_SCHEMA_VERSION,
  readExperimentManagedDocuments,
  renderExperimentManagedSection,
  renderImplementationMarkdown,
  renderInvestigationMarkdown,
  renderManagedDocumentMarkdown,
  renderResultColumnAnnotationsMarkdown,
  renderResultsMarkdown,
  serializeImplementationYaml,
  serializeInvestigationYaml,
  serializeResultsYaml,
  upsertResultColumnAnnotationYaml,
  validateExperimentManagedDocuments,
} from './experiments/documents.js'
export { nextExperimentId, resolveExperimentId } from './experiments/id.js'
export type { MembershipInput, MembershipResult } from './experiments/membership.js'
export { computeMembership } from './experiments/membership.js'
export type {
  CreateExperimentInput,
  CreateExperimentResult,
  DeleteExperimentInput,
  DeleteExperimentResult,
  DocumentLock,
  DocumentState,
  ExperimentArchiveInput,
  ExperimentBundle,
  ExperimentBundleInput,
  ExperimentReadmeInput,
  ExperimentRunBindInput,
  ExperimentRunBindResult,
  ExperimentStatusInput,
  ExperimentStatusResult,
  ExperimentTarget,
  FileChange,
  MutationBase,
  MutationErrorCode,
  MutationErrorReason,
  MutationFs,
  MutationRun,
  ReadmeWriteResult,
  ToggleResult,
  WarningMutationInput,
  WarningMutationResult,
} from './experiments/mutations.js'
// Experiment write primitives shared by CLI, Backend and standalone Web
export {
  addExperimentWarning,
  assertDocumentLock,
  buildExperimentBundle,
  CANONICAL_EXPERIMENT_BUNDLE_FILES,
  createExperiment,
  deleteExperiment,
  IMPORTED_VARIANT_DESCRIPTION,
  importedVariantStatus,
  linkExperimentRun,
  MutationError,
  mutateDocumentWarning,
  nodeMutationFs,
  readDocumentLock,
  readDocumentState,
  replaceDocumentAtomic,
  setExperimentArchived,
  setExperimentStatus,
  sha1,
  staleLockField,
  unlinkExperimentRun,
  writeExperimentReadme,
} from './experiments/mutations.js'
export type { ParsedExperiment } from './experiments/parse.js'
// v3 experiment-doc parser / serializer / discovery / membership
export { buildExperimentRecord, parseExperimentReadme } from './experiments/parse.js'
export type {
  RenameExperimentOptions,
  RenameExperimentResult,
  RenameExperimentWarning,
} from './experiments/rename.js'
export { RenameExperimentError, renameExperiment } from './experiments/rename.js'
export type {
  ResultsMetricsValidity,
  ResultsVariantEligibility,
} from './experiments/results-eligibility.js'
export {
  projectResultsRunEligibility,
  variantHasMetrics,
} from './experiments/results-eligibility.js'
export {
  declaredRunOwner,
  isRunPath,
  projectRunPath,
  resolveDeclaredRunPath,
  resolveRunReference,
} from './experiments/run-path.js'
export type { SerializeExperimentInput } from './experiments/serialize.js'
export { serializeExperimentReadme } from './experiments/serialize.js'
export {
  buildExperimentDocumentView,
  type ExperimentDisplaySection,
  type ExperimentDocumentView,
} from './experiments/view.js'
export type { FrontmatterSplit } from './frontmatter.js'
export { splitFrontmatter } from './frontmatter.js'
export type { FsVersionRecord, FsVersionStatus } from './fs-version/index.js'
export {
  computeFsVersionStatus,
  FsVersionSchemaError,
  readFsVersion,
  resolveVersionFilePath,
  validateFsVersionRecord,
  writeFsVersion,
} from './fs-version/index.js'
export type { GitCommandOptions, GitCommandResult, GitCommandRunner } from './git/command.js'
export {
  cachedGitCommand,
  gitCommandStdoutText,
  invalidateGitOperations,
  isGitCommandFailure,
} from './git/command.js'
export type {
  CommitMark,
  CommitMarkStatus,
  ReadCommitMarksOptions,
  ReadCommitMarksResult,
} from './git/commit-marks.js'
export {
  COMMIT_MARK_STATUSES,
  COMMIT_MARKS_RELPATH,
  deleteCommitMark,
  readCommitMarks,
  setCommitMark,
} from './git/commit-marks.js'
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
  MAX_DIFF_BYTES,
  parsePorcelainV2WithFiles,
  readGitFileContents,
  readGitStatusFiles,
} from './git/files.js'
export type { CodeContext, GithubPermalink, PreviewLine } from './git/github-permalink.js'
export { parseGithubPermalink, sliceContext } from './git/github-permalink.js'
export type {
  GitBranchEntry,
  GitBranches,
  GitCommitDetail,
  GitCommitSummary,
  GitLog,
  GitRange,
  ReadGitHistoryOptions,
} from './git/history.js'
export {
  parseDiffTreeNameStatus,
  parseDiffTreeRaw,
  readGitBranches,
  readGitCommit,
  readGitLog,
  readGitRange,
} from './git/history.js'
export type { GitStatus, ReadGitStatusOptions } from './git/status.js'
export { parsePorcelainV2, readGitStatus } from './git/status.js'
export type {
  GitSubmoduleEntry,
  GitSubmodules,
  ReadGitSubmodulesOptions,
} from './git/submodules.js'
export { readGitSubmodules } from './git/submodules.js'
export { parseExperimentRefList, parseHypotheses } from './hypotheses/parse.js'
export type { IdPrefix, ParsedId } from './ids.js'
export {
  EXPERIMENT_REF_REGEX,
  extractRunMentions,
  ID_MAX,
  ID_MIN,
  ID_PREFIXES,
  ID_REGEX,
  ID_WIDTH,
  isId,
  padId,
  parseId,
  RUN_MENTION_SOURCE,
  RUN_TIMESTAMP_TAIL_REGEX,
  SLUG_REGEX,
  SLUG_SOURCE,
  SLUG_STRICT_REGEX,
} from './ids.js'
export { appendJournalEvent } from './journal/append.js'
export type {
  JournalActivitySnapshot,
  JournalInvocationContext,
  JournalInvocationDetail,
  JournalInvocationHandle,
  JournalInvocationInput,
  JournalInvocationOptions,
  JournalInvocationOrigin,
  JournalInvocationOutcome,
  JournalInvocationRecord,
  JournalInvocationTerminalOutcome,
  JournalRecordingFailure,
  UnreadableJournalReceipt,
} from './journal/invocation.js'
export {
  addJournalInvocationDetail,
  beginJournalInvocation,
  classifyError as classifyJournalInvocationError,
  currentJournalInvocation,
  JOURNAL_ACTIVITY_RELDIR,
  JOURNAL_INVOCATION_MAX_DETAILS,
  JOURNAL_INVOCATION_OUTCOMES,
  JOURNAL_INVOCATION_RECORD_VERSION,
  JournalInvocationDetailSchema,
  JournalInvocationOriginSchema,
  JournalInvocationOutcomeSchema,
  JournalInvocationRecordSchema,
  JournalRecordingError,
  markJournalInvocationOutcome,
  readJournalActivity,
  readJournalInvocations,
  sanitizeInvocationParameters,
  withJournalInvocation,
} from './journal/invocation.js'
export { parseJournal } from './journal/parse.js'
export type { JournalSnapshot } from './journal/read.js'
export { JOURNAL_RELPATH, readProjectJournal } from './journal/read.js'
export {
  formatJournalEvent,
  reserializeJournal,
  serializeJournal,
} from './journal/serialize.js'
export type {
  AppendResult,
  LineIndexOptions,
  LineRange,
  LineRangeOptions,
} from './log/line-index.js'
export { DEFAULT_ANCHOR_EVERY, LineIndex } from './log/line-index.js'
export {
  type ApplyMembershipMigrationOptions,
  applyMembershipMigration,
  type MembershipMigrationPlan,
  planMembershipMigration,
  rollbackMembershipMigration,
} from './migrations/v6-to-v7.js'
export * from './project-file-store.js'
export * from './project-resource.js'
// Project scanning and Run target resolution (CLI, Backend and Web).
export type { LoadCliContextInput, LoadCliContextResult } from './project-scan/context.js'
export { CliContextError, loadCliContext } from './project-scan/context.js'
export type { RunTargetOptions } from './project-scan/resolve-run.js'
export { RunTargetIndex, resolveRunTarget } from './project-scan/resolve-run.js'
export type { IndexedRun, ProjectSnapshot, ScanOptions } from './project-scan/scan.js'
export { ScanError, scanProjectRoot } from './project-scan/scan.js'
export { parseArtifacts } from './readme/artifacts.js'
export type {
  PatchableRunFrontMatterKey,
  RunFrontMatterPatch,
} from './readme/frontmatter-patch.js'
export {
  patchRunFrontMatter,
  RunFrontMatterPatchError,
} from './readme/frontmatter-patch.js'
export type { RunLintDiagnostic } from './readme/lint.js'
export { lintRun } from './readme/lint.js'
export { parseReadme } from './readme/parse.js'
export type { H2SectionEntry, SectionSplit } from './readme/sections.js'
export { splitH2Sections } from './readme/sections.js'
export type { SerializeMinimalRunInput, SerializeReadmeInput } from './readme/serialize.js'
export {
  MINIMAL_RUN_FRONT_MATTER_KEYS,
  reserializeReadme,
  serializeMinimalRun,
  serializeReadme,
} from './readme/serialize.js'
export { extractTitle } from './readme/title.js'
export type {
  ApplyWarningOpResult,
  ParsedWarnings,
  SectionRange as WarningsSectionRange,
  Warning,
  WarningCategory,
  WarningOp,
  WarningStatus,
} from './readme/warnings.js'
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
export * from './release-compatibility.js'
export * from './release-policy.js'
export type {
  RenameRunInput,
  RenameRunResult,
  RunArchiveInput,
  RunArchiveResult,
  RunReadmeInput,
  RunReadmeResult,
  RunStatusInput,
  RunStatusResult,
} from './runs/mutations.js'
// Run write primitives shared by CLI, Backend and standalone Web
export {
  ARCHIVED_RUNNING_MESSAGE,
  canonicalRunSansUpdatedAt,
  RUNNING_ARCHIVE_MESSAGE,
  renameRun,
  setRunArchiveState,
  setRunStatus,
  writeRunReadme,
} from './runs/mutations.js'
export type {
  CodeReviewFrontMatterRaw,
  ExperimentFrontMatterRaw,
  RunFrontMatterRaw,
} from './schemas.js'
export {
  CodeReviewFrontMatterRawSchema,
  ExperimentFrontMatterRawSchema,
  RunFrontMatterRawSchema,
} from './schemas.js'
export type {
  AddShareOptions,
  RevokeShareOptions,
  ShareRecord,
  SharesFile,
} from './shares/index.js'

export {
  AmbiguousShareError,
  addShare,
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
export * from './status.js'
export {
  formatIsoLocal,
  formatRunStamp,
  parseSlugFromRunDir,
  parseTimestampFromRunDir,
} from './time.js'
// v3 experiment doc types (sed-renamed from Experiment* during rename pass)
export type {
  Experiment,
  ExperimentFrontMatter,
  ExperimentMembershipAnomaly,
  ExperimentMembershipAnomalyCode,
  ExperimentSections,
  ExperimentWarningRecord,
} from './types.js'
export * from './types.js'
export { EXPERIMENT_DIR_REGEX, EXPERIMENT_FILENAME_REGEX } from './types.js'
export type { MemonReleaseMetadata } from './version.js'
export {
  assertReleaseMajorMatchesFsConvention,
  FS_CONVENTION_VERSION,
  MEMON_RELEASE,
  MEMON_RELEASE_METADATA,
  MEMON_REVISION,
  parseMemonReleaseMajor,
  VERSION,
} from './version.js'
export * from './wiki/index.js'
