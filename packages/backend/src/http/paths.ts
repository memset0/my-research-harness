// Backend wire paths and request-size limits. Route templates use `[name]`
// placeholders and `[...name]` rest placeholders.

export const BACKEND_API_PREFIX = '/api/backend/v1'
export const BACKEND_META_PATH = `${BACKEND_API_PREFIX}/meta`
export const BACKEND_EVENTS_PATH = `${BACKEND_API_PREFIX}/events`
export const BACKEND_PROJECTS_PATH = `${BACKEND_API_PREFIX}/projects`
export const BACKEND_SHARE_VALIDATE_ROUTE = `${BACKEND_API_PREFIX}/projects/[project]/shares/validate`
export const BACKEND_SHARES_ROUTE = `${BACKEND_API_PREFIX}/projects/[project]/shares`
export const BACKEND_SHARE_ITEM_ROUTE = `${BACKEND_API_PREFIX}/projects/[project]/shares/[id]`
export const BACKEND_RUNS_ROUTE = `${BACKEND_API_PREFIX}/runs`
export const BACKEND_RUN_ROUTE = `${BACKEND_API_PREFIX}/runs/[id]`
export const BACKEND_EXPERIMENTS_ROUTE = `${BACKEND_API_PREFIX}/experiments`
export const BACKEND_EXPERIMENT_ROUTE = `${BACKEND_API_PREFIX}/experiments/[id]`
export const BACKEND_HYPOTHESES_ROUTE = `${BACKEND_API_PREFIX}/hypotheses`
/** Legacy `docs/journal.md` read; stays inside the existing viewer scope. */
export const BACKEND_JOURNAL_ROUTE = `${BACKEND_API_PREFIX}/journal`
/** Owner-only merged diagnostics: legacy history plus invocation receipts. */
export const BACKEND_JOURNAL_HISTORY_ROUTE = `${BACKEND_API_PREFIX}/journal/history`
export const BACKEND_ANOMALIES_ROUTE = `${BACKEND_API_PREFIX}/anomalies`
export const BACKEND_REPORTS_ROUTE = `${BACKEND_API_PREFIX}/reports`
export const BACKEND_REPORT_ROUTE = `${BACKEND_API_PREFIX}/reports/[id]`
export const BACKEND_CODE_REVIEWS_ROUTE = `${BACKEND_API_PREFIX}/code-reviews`
export const BACKEND_CODE_REVIEW_ROUTE = `${BACKEND_API_PREFIX}/code-reviews/[...id]`
export const BACKEND_README_ROUTE = `${BACKEND_API_PREFIX}/readme`
export const BACKEND_RUN_README_ROUTE = `${BACKEND_API_PREFIX}/runs/[id]/readme`
export const BACKEND_EXPERIMENT_README_ROUTE = `${BACKEND_API_PREFIX}/experiments/[id]/readme`
export const BACKEND_RUN_FILES_ROUTE = `${BACKEND_API_PREFIX}/runs/[id]/files`
export const BACKEND_EXPERIMENT_RESULTS_ROUTE = `${BACKEND_API_PREFIX}/experiments/[id]/results`
export const BACKEND_GIT_STATUS_ROUTE = `${BACKEND_API_PREFIX}/projects/[project]/git-status`
export const BACKEND_GIT_STATUS_FILES_ROUTE = `${BACKEND_API_PREFIX}/projects/[project]/git-status/files`
export const BACKEND_GIT_BRANCHES_ROUTE = `${BACKEND_API_PREFIX}/projects/[project]/git-branches`
export const BACKEND_GIT_LOG_ROUTE = `${BACKEND_API_PREFIX}/projects/[project]/git-log`
export const BACKEND_GIT_COMMIT_ROUTE = `${BACKEND_API_PREFIX}/projects/[project]/git-commit`
export const BACKEND_GIT_RANGE_ROUTE = `${BACKEND_API_PREFIX}/projects/[project]/git-range`
export const BACKEND_GIT_DIFF_ROUTE = `${BACKEND_API_PREFIX}/projects/[project]/git-diff`
export const BACKEND_GIT_SUBMODULES_ROUTE = `${BACKEND_API_PREFIX}/projects/[project]/submodules`
export const BACKEND_GIT_COMMIT_MARKS_ROUTE = `${BACKEND_API_PREFIX}/projects/[project]/commit-marks`
export const BACKEND_GIT_COMMIT_MARK_ROUTE = `${BACKEND_API_PREFIX}/projects/[project]/commit-marks/[sha]`
export const BACKEND_CODE_PREVIEW_ROUTE = `${BACKEND_API_PREFIX}/code-preview`
export const BACKEND_SLURM_STATUS_ROUTE = `${BACKEND_API_PREFIX}/slurm/status`
export const BACKEND_RUN_STATUS_ROUTE = `${BACKEND_API_PREFIX}/runs/[id]/status`
export const BACKEND_RUN_ARCHIVE_ROUTE = `${BACKEND_API_PREFIX}/runs/[id]/archive`
export const BACKEND_EXPERIMENT_STATUS_ROUTE = `${BACKEND_API_PREFIX}/experiments/[id]/status`
export const BACKEND_EXPERIMENT_ARCHIVE_ROUTE = `${BACKEND_API_PREFIX}/experiments/[id]/archive`
export const BACKEND_RUN_WARNINGS_ROUTE = `${BACKEND_API_PREFIX}/runs/[id]/warnings`
export const BACKEND_RUN_WARNING_ROUTE = `${BACKEND_API_PREFIX}/runs/[id]/warnings/[rowId]`
export const BACKEND_EXPERIMENT_WARNINGS_ROUTE = `${BACKEND_API_PREFIX}/experiments/[id]/warnings`
export const BACKEND_EXPERIMENT_WARNING_ROUTE = `${BACKEND_API_PREFIX}/experiments/[id]/warnings/[rowId]`
export const BACKEND_EXPERIMENT_LINK_ROUTE = `${BACKEND_API_PREFIX}/experiments/[id]/link`
export const BACKEND_EXPERIMENT_UNLINK_ROUTE = `${BACKEND_API_PREFIX}/experiments/[id]/unlink`
export const BACKEND_LOG_FILES_ROUTE = `${BACKEND_API_PREFIX}/log-files`
export const BACKEND_LOG_ROUTE = `${BACKEND_API_PREFIX}/log`
export const BACKEND_LOG_STREAM_ROUTE = `${BACKEND_API_PREFIX}/log/stream`
export const BACKEND_REPORT_ASSET_ROUTE = `${BACKEND_API_PREFIX}/report-assets/[project]/[id]/[...path]`
export const BACKEND_WIKI_ROUTE = `${BACKEND_API_PREFIX}/wiki`
export const BACKEND_WIKI_PAGE_ROUTE = `${BACKEND_API_PREFIX}/wiki/[id]`
export const BACKEND_WIKI_BACKLINKS_ROUTE = `${BACKEND_API_PREFIX}/wiki/backlinks/[artifact]`
export const BACKEND_WIKI_REVIEW_ROUTE = `${BACKEND_API_PREFIX}/wiki/review`
export const BACKEND_WIKI_REVIEW_MARK_ROUTE = `${BACKEND_API_PREFIX}/wiki/review/[sha]`
export const BACKEND_WIKI_ASSET_ROUTE = `${BACKEND_API_PREFIX}/wiki-assets/[project]/[id]/[...path]`

export const MAX_BACKEND_CONTROL_JSON_BYTES = 1024 * 1024
/**
 * Response bound of the Experiment detail and Results snapshot reads. Their
 * JSON carries the sanitized Results document (and, for detail, its rendered
 * projection), which outgrows the control bound for large Results tables.
 */
export const MAX_BACKEND_EXPERIMENT_DOCUMENT_JSON_BYTES = 16 * 1024 * 1024
export const MAX_BACKEND_DOCUMENT_BODY_BYTES = 5 * 1024 * 1024
export const MAX_BACKEND_GIT_CONTROL_BODY_BYTES = 128 * 1024
export const MAX_BACKEND_SHARE_VALIDATION_BODY_BYTES = 4 * 1024
