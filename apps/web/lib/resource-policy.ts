// Shared browser/server classification. Collections are background work even
// when requested while opening, focusing or manually refreshing a document.
// This is scheduling policy, not another cache or a new polling interval.

const COLLECTION_PATHS = new Set([
  '/api/projects',
  '/api/hosts',
  '/api/experiments',
  '/api/runs',
  '/api/wiki',
  '/api/wiki/review',
  '/api/reports',
  '/api/code-reviews',
  '/api/hypotheses',
  '/api/journal',
  '/api/journal/history',
  '/api/anomalies',
  '/api/log-files',
  '/api/slurm/status',
  '/api/experiment-results-views',
])

const COLLECTION_SUBRESOURCE =
  /^(?:\/api\/wiki\/backlinks\/[^/]+|\/api\/runs\/[^/]+\/(?:files|warnings)|\/api\/experiments\/[^/]+\/warnings|\/api\/projects\/[^/]+\/(?:git-status(?:\/files)?|git-branches|git-log|submodules|shares|commit-marks))\/?$/

export function isCollectionResourcePath(pathname: string): boolean {
  const path = pathname.endsWith('/') ? pathname.slice(0, -1) : pathname
  return COLLECTION_PATHS.has(path) || COLLECTION_SUBRESOURCE.test(path)
}

const COLLECTION_QUERY_ROOTS = new Set([
  'projects',
  'hosts',
  'experiments',
  'experiments-inventory',
  'runs',
  'runs-inventory',
  'wiki',
  'wiki-inventory',
  'wiki-backlinks',
  'wiki-review',
  'reports',
  'reports-inventory',
  'code-reviews',
  'code-reviews-inventory',
  'hypotheses',
  'journal',
  'journal-count',
  'journal-history',
  'anomalies',
  'log-files',
  'slurm-status',
  'git-status',
  'git-branches',
  'git-log',
  'submodules',
  'commit-marks',
  'experiment-results-views',
  'run-files',
])

export function isCollectionResourceQuery(queryKey: readonly unknown[]): boolean {
  return typeof queryKey[0] === 'string' && COLLECTION_QUERY_ROOTS.has(queryKey[0])
}
