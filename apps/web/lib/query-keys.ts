// The single definition of every TanStack Query key the dashboard uses.
//
// Reads, server-side prefetches, cache writes, invalidations and manual
// refreshes all build keys here, so a prefetch and the client read it hydrates
// (or a write and the reads it invalidates) cannot drift apart. Runtime shapes
// are a contract — TanStack matches by hashed value and prefix — and each
// constructor's output is locked by `query-keys.test.ts`.
//
// Project-scoped keys put the Project right after the root via
// `projectQueryKey`: `[root, project, …]` for a plain Project name and
// `[root, host, project, …]` for a Host-qualified ProjectRef.

import { type ProjectTarget, projectQueryKey } from './project-target'

/** Project segment, or nothing when the caller has no Project in scope. */
function scope(project: ProjectTarget | undefined) {
  return project ? projectQueryKey(project) : ([] as const)
}

export type TabCollectionKind =
  | 'experiments'
  | 'hypotheses'
  | 'journal'
  | 'reports'
  | 'code-review'
  | 'wiki'

export const queryKeys = {
  // Global
  projects: () => ['projects'] as const,
  hosts: () => ['hosts'] as const,
  slurmStatus: () => ['slurm-status'] as const,
  fileAccess: (windowMs: number) => ['file-access', windowMs] as const,

  // Runs. `project` is optional where the caller may act outside a Project
  // scope; the key then omits the Project segment.
  allRuns: () => ['runs'] as const,
  runs: (project?: ProjectTarget) => ['runs', ...scope(project)] as const,
  run: (project: ProjectTarget | undefined, id: string) => ['run', ...scope(project), id] as const,
  runFiles: (project: ProjectTarget, id: string) =>
    ['run-files', ...projectQueryKey(project), id] as const,

  // Experiments
  experiments: (project?: ProjectTarget) => ['experiments', ...scope(project)] as const,
  experiment: (project: ProjectTarget | undefined, id: string) =>
    ['experiment', ...scope(project), id] as const,
  experimentsInventory: (project: ProjectTarget) =>
    ['experiments-inventory', ...projectQueryKey(project)] as const,

  // Hypotheses and journal
  hypotheses: (project: ProjectTarget) => ['hypotheses', ...projectQueryKey(project)] as const,
  journal: (project: ProjectTarget) => ['journal', ...projectQueryKey(project)] as const,
  journalHistory: (project: ProjectTarget) =>
    ['journal-history', ...projectQueryKey(project)] as const,
  journalCount: (project: ProjectTarget) => ['journal-count', ...projectQueryKey(project)] as const,

  // Reports
  reports: (project: ProjectTarget) => ['reports', ...projectQueryKey(project)] as const,
  /**
   * Legacy spelling kept byte-identical: it embeds the raw target instead of
   * spreading it, so for a Host-qualified Project it does not prefix-match
   * `reports(project)`. Preserved by the web-lib-layering refactor; fixing it
   * is a separate behavior change.
   */
  reportsRawTarget: (project: ProjectTarget) => ['reports', project] as const,
  /** `id` is null while no Report is selected (the query is disabled). */
  report: (project: ProjectTarget, id: string | null) =>
    ['report', ...projectQueryKey(project), id] as const,
  reportsInventory: (project: ProjectTarget) =>
    ['reports-inventory', ...projectQueryKey(project)] as const,

  // Code reviews
  codeReviews: (project: ProjectTarget) => ['code-reviews', ...projectQueryKey(project)] as const,
  codeReview: (project: ProjectTarget, id: string) =>
    ['code-review', ...projectQueryKey(project), id] as const,
  codeReviewsInventory: (project: ProjectTarget) =>
    ['code-reviews-inventory', ...projectQueryKey(project)] as const,
  codePreview: (project: ProjectTarget, href: string) =>
    ['code-preview', ...projectQueryKey(project), href] as const,

  // Wiki
  wiki: (project: ProjectTarget) => ['wiki', ...projectQueryKey(project)] as const,
  /** `id` is null while no page is selected (the query is disabled). */
  wikiPage: (project: ProjectTarget, id: string | null) =>
    ['wiki-page', ...projectQueryKey(project), id] as const,
  wikiInventory: (project: ProjectTarget) =>
    ['wiki-inventory', ...projectQueryKey(project)] as const,
  wikiReview: (project: ProjectTarget) => ['wiki-review', ...projectQueryKey(project)] as const,
  wikiBacklinks: (project: ProjectTarget, artifactId: string) =>
    ['wiki-backlinks', ...projectQueryKey(project), artifactId] as const,

  // Git
  gitStatus: (project: ProjectTarget) => ['git-status', ...projectQueryKey(project)] as const,
  gitStatusFiles: (project: ProjectTarget, submodule?: string) =>
    submodule
      ? (['git-status-files', ...projectQueryKey(project), submodule] as const)
      : (['git-status-files', ...projectQueryKey(project)] as const),
  gitDiff: (
    project: ProjectTarget,
    path: string,
    side: string,
    sha: string | undefined,
    submodule: string | undefined,
    rangeFrom: string | undefined,
    rangeTo: string | undefined,
  ) =>
    [
      'git-diff',
      ...projectQueryKey(project),
      path,
      side,
      sha,
      submodule,
      rangeFrom,
      rangeTo,
    ] as const,
  gitRange: (project: ProjectTarget, submodule: string, fromSha: string, toSha: string) =>
    ['git-range', ...projectQueryKey(project), submodule, fromSha, toSha] as const,
  submodules: (project: ProjectTarget) => ['submodules', ...projectQueryKey(project)] as const,
  gitBranches: (project: ProjectTarget, submodule: string | undefined) =>
    ['git-branches', ...projectQueryKey(project), submodule] as const,
  gitLog: (project: ProjectTarget, submodule: string | undefined, rev: string | null | undefined) =>
    ['git-log', ...projectQueryKey(project), submodule, rev] as const,
  /** Commit detail in the history dialog (submodule slot always present). */
  gitCommit: (project: ProjectTarget, submodule: string | undefined, sha: string | null) =>
    ['git-commit', ...projectQueryKey(project), submodule, sha] as const,
  /** Commit detail in the wiki review panel (no submodule slot). */
  gitCommitAtRoot: (project: ProjectTarget, sha: string) =>
    ['git-commit', ...projectQueryKey(project), sha] as const,
  commitMarks: (project: ProjectTarget) => ['commit-marks', ...projectQueryKey(project)] as const,

  // Logs and shares
  logFiles: (project: ProjectTarget, selector: string | undefined) =>
    ['log-files', ...projectQueryKey(project), selector] as const,
  projectShares: (project: ProjectTarget) =>
    ['project-shares', ...projectQueryKey(project)] as const,

  // Document component cache files
  docAsset: (project: string, host: string | null, cachePath: string) =>
    ['doc-asset', project, host, cachePath] as const,

  /** Collection behind an AppBar tab count badge. */
  tabCollection: (kind: TabCollectionKind, project: ProjectTarget) => {
    switch (kind) {
      case 'experiments':
        return queryKeys.experimentsInventory(project)
      case 'hypotheses':
        return queryKeys.hypotheses(project)
      case 'journal':
        return queryKeys.journalCount(project)
      case 'reports':
        return queryKeys.reportsInventory(project)
      case 'code-review':
        return queryKeys.codeReviewsInventory(project)
      case 'wiki':
        return queryKeys.wikiInventory(project)
    }
  },
}
