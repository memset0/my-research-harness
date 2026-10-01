// Legacy route tables, moved verbatim from server.ts. They coexist with the
// declarative route table only until its parity test has been recorded.

import { BackendGitRefSchema, ProjectNameSchema, ResourceIdSchema } from '@memon/core'
import {
  BACKEND_ANOMALIES_ROUTE,
  BACKEND_API_PREFIX,
  BACKEND_CODE_PREVIEW_ROUTE,
  BACKEND_CODE_REVIEW_ROUTE,
  BACKEND_CODE_REVIEWS_ROUTE,
  BACKEND_EVENTS_PATH,
  BACKEND_EXPERIMENT_ARCHIVE_ROUTE,
  BACKEND_EXPERIMENT_LINK_ROUTE,
  BACKEND_EXPERIMENT_README_ROUTE,
  BACKEND_EXPERIMENT_RESULTS_ROUTE,
  BACKEND_EXPERIMENT_ROUTE,
  BACKEND_EXPERIMENT_STATUS_ROUTE,
  BACKEND_EXPERIMENT_UNLINK_ROUTE,
  BACKEND_EXPERIMENT_WARNING_ROUTE,
  BACKEND_EXPERIMENT_WARNINGS_ROUTE,
  BACKEND_EXPERIMENTS_ROUTE,
  BACKEND_GIT_BRANCHES_ROUTE,
  BACKEND_GIT_COMMIT_MARK_ROUTE,
  BACKEND_GIT_COMMIT_MARKS_ROUTE,
  BACKEND_GIT_COMMIT_ROUTE,
  BACKEND_GIT_DIFF_ROUTE,
  BACKEND_GIT_LOG_ROUTE,
  BACKEND_GIT_RANGE_ROUTE,
  BACKEND_GIT_STATUS_FILES_ROUTE,
  BACKEND_GIT_STATUS_ROUTE,
  BACKEND_GIT_SUBMODULES_ROUTE,
  BACKEND_HYPOTHESES_ROUTE,
  BACKEND_JOURNAL_HISTORY_ROUTE,
  BACKEND_JOURNAL_ROUTE,
  BACKEND_LOG_FILES_ROUTE,
  BACKEND_LOG_ROUTE,
  BACKEND_LOG_STREAM_ROUTE,
  BACKEND_META_PATH,
  BACKEND_PROJECTS_PATH,
  BACKEND_README_ROUTE,
  BACKEND_REPORT_ASSET_ROUTE,
  BACKEND_REPORT_ROUTE,
  BACKEND_REPORTS_ROUTE,
  BACKEND_RUN_ARCHIVE_ROUTE,
  BACKEND_RUN_FILES_ROUTE,
  BACKEND_RUN_README_ROUTE,
  BACKEND_RUN_ROUTE,
  BACKEND_RUN_STATUS_ROUTE,
  BACKEND_RUN_WARNING_ROUTE,
  BACKEND_RUN_WARNINGS_ROUTE,
  BACKEND_RUNS_ROUTE,
  BACKEND_SHARE_ITEM_ROUTE,
  BACKEND_SHARE_VALIDATE_ROUTE,
  BACKEND_SHARES_ROUTE,
  BACKEND_SLURM_STATUS_ROUTE,
  BACKEND_WIKI_ASSET_ROUTE,
  BACKEND_WIKI_BACKLINKS_ROUTE,
  BACKEND_WIKI_PAGE_ROUTE,
  BACKEND_WIKI_REVIEW_MARK_ROUTE,
  BACKEND_WIKI_REVIEW_ROUTE,
  BACKEND_WIKI_ROUTE,
} from './http/paths.js'

export const BACKEND_ROUTE_ALLOW_LIST = Object.freeze({
  [BACKEND_META_PATH]: Object.freeze(['GET'] as const),
  [BACKEND_EVENTS_PATH]: Object.freeze(['GET'] as const),
  [BACKEND_PROJECTS_PATH]: Object.freeze(['GET'] as const),
  [BACKEND_SHARE_VALIDATE_ROUTE]: Object.freeze(['POST'] as const),
  [BACKEND_SHARES_ROUTE]: Object.freeze(['GET', 'POST'] as const),
  [BACKEND_SHARE_ITEM_ROUTE]: Object.freeze(['DELETE'] as const),
  [BACKEND_RUNS_ROUTE]: Object.freeze(['GET'] as const),
  [BACKEND_RUN_ROUTE]: Object.freeze(['GET'] as const),
  [BACKEND_EXPERIMENTS_ROUTE]: Object.freeze(['GET', 'POST'] as const),
  [BACKEND_EXPERIMENT_ROUTE]: Object.freeze(['GET', 'DELETE'] as const),
  [BACKEND_HYPOTHESES_ROUTE]: Object.freeze(['GET'] as const),
  [BACKEND_JOURNAL_ROUTE]: Object.freeze(['GET'] as const),
  [BACKEND_JOURNAL_HISTORY_ROUTE]: Object.freeze(['GET'] as const),
  [BACKEND_ANOMALIES_ROUTE]: Object.freeze(['GET'] as const),
  [BACKEND_REPORTS_ROUTE]: Object.freeze(['GET'] as const),
  [BACKEND_REPORT_ROUTE]: Object.freeze(['GET', 'PUT'] as const),
  [BACKEND_CODE_REVIEWS_ROUTE]: Object.freeze(['GET'] as const),
  [BACKEND_CODE_REVIEW_ROUTE]: Object.freeze(['GET', 'PATCH'] as const),
  [BACKEND_README_ROUTE]: Object.freeze(['GET', 'PUT'] as const),
  [BACKEND_RUN_README_ROUTE]: Object.freeze(['GET', 'PUT'] as const),
  [BACKEND_EXPERIMENT_README_ROUTE]: Object.freeze(['GET', 'PUT'] as const),
  [BACKEND_RUN_FILES_ROUTE]: Object.freeze(['GET'] as const),
  [BACKEND_EXPERIMENT_RESULTS_ROUTE]: Object.freeze(['GET'] as const),
  [BACKEND_GIT_STATUS_ROUTE]: Object.freeze(['GET'] as const),
  [BACKEND_GIT_STATUS_FILES_ROUTE]: Object.freeze(['GET'] as const),
  [BACKEND_GIT_BRANCHES_ROUTE]: Object.freeze(['GET'] as const),
  [BACKEND_GIT_LOG_ROUTE]: Object.freeze(['GET'] as const),
  [BACKEND_GIT_COMMIT_ROUTE]: Object.freeze(['GET'] as const),
  [BACKEND_GIT_RANGE_ROUTE]: Object.freeze(['GET'] as const),
  [BACKEND_GIT_DIFF_ROUTE]: Object.freeze(['GET'] as const),
  [BACKEND_GIT_SUBMODULES_ROUTE]: Object.freeze(['GET'] as const),
  [BACKEND_GIT_COMMIT_MARKS_ROUTE]: Object.freeze(['GET'] as const),
  [BACKEND_GIT_COMMIT_MARK_ROUTE]: Object.freeze(['PUT', 'DELETE'] as const),
  [BACKEND_CODE_PREVIEW_ROUTE]: Object.freeze(['GET'] as const),
  [BACKEND_SLURM_STATUS_ROUTE]: Object.freeze(['GET'] as const),
  [BACKEND_RUN_STATUS_ROUTE]: Object.freeze(['PATCH'] as const),
  [BACKEND_RUN_ARCHIVE_ROUTE]: Object.freeze(['PATCH'] as const),
  [BACKEND_EXPERIMENT_STATUS_ROUTE]: Object.freeze(['PATCH'] as const),
  [BACKEND_EXPERIMENT_ARCHIVE_ROUTE]: Object.freeze(['PATCH'] as const),
  [BACKEND_RUN_WARNINGS_ROUTE]: Object.freeze(['GET', 'POST'] as const),
  [BACKEND_RUN_WARNING_ROUTE]: Object.freeze(['PATCH', 'DELETE'] as const),
  [BACKEND_EXPERIMENT_WARNINGS_ROUTE]: Object.freeze(['GET', 'POST'] as const),
  [BACKEND_EXPERIMENT_WARNING_ROUTE]: Object.freeze(['PATCH', 'DELETE'] as const),
  [BACKEND_EXPERIMENT_LINK_ROUTE]: Object.freeze(['POST'] as const),
  [BACKEND_EXPERIMENT_UNLINK_ROUTE]: Object.freeze(['POST'] as const),
  [BACKEND_LOG_FILES_ROUTE]: Object.freeze(['GET'] as const),
  [BACKEND_LOG_ROUTE]: Object.freeze(['GET'] as const),
  [BACKEND_LOG_STREAM_ROUTE]: Object.freeze(['GET'] as const),
  [BACKEND_REPORT_ASSET_ROUTE]: Object.freeze(['GET', 'HEAD'] as const),
  [BACKEND_WIKI_ROUTE]: Object.freeze(['GET'] as const),
  [BACKEND_WIKI_PAGE_ROUTE]: Object.freeze(['GET', 'PUT'] as const),
  [BACKEND_WIKI_BACKLINKS_ROUTE]: Object.freeze(['GET'] as const),
  [BACKEND_WIKI_REVIEW_ROUTE]: Object.freeze(['GET'] as const),
  [BACKEND_WIKI_REVIEW_MARK_ROUTE]: Object.freeze(['POST', 'DELETE'] as const),
  [BACKEND_WIKI_ASSET_ROUTE]: Object.freeze(['GET', 'HEAD'] as const),
})

export interface AllowedBackendRoute {
  key: keyof typeof BACKEND_ROUTE_ALLOW_LIST
  methods: readonly string[]
  project?: ReturnType<typeof ProjectNameSchema.parse>
  shareId?: string
  resourceId?: ReturnType<typeof ResourceIdSchema.parse>
  gitRef?: ReturnType<typeof BackendGitRefSchema.parse>
  warningRowId?: string
  reportId?: string
  wikiId?: string
  wikiArtifact?: string
  wikiSha?: string
}

export function resolveAllowedBackendRoute(pathname: string): AllowedBackendRoute | null {
  if (Object.hasOwn(BACKEND_ROUTE_ALLOW_LIST, pathname)) {
    const key = pathname as keyof typeof BACKEND_ROUTE_ALLOW_LIST
    return { key, methods: BACKEND_ROUTE_ALLOW_LIST[key] }
  }
  const prefix = BACKEND_API_PREFIX.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const readmeMatch = new RegExp(`^${prefix}/(runs|experiments)/([^/]+)/readme$`).exec(pathname)
  if (readmeMatch) {
    let decodedId: string
    try {
      decodedId = decodeURIComponent(readmeMatch[2]!)
    } catch {
      return null
    }
    const resourceId = ResourceIdSchema.safeParse(decodedId)
    if (!resourceId.success) return null
    const key =
      readmeMatch[1] === 'runs' ? BACKEND_RUN_README_ROUTE : BACKEND_EXPERIMENT_README_ROUTE
    return { key, methods: BACKEND_ROUTE_ALLOW_LIST[key], resourceId: resourceId.data }
  }
  const resourceReadMatch = new RegExp(
    `^${prefix}/(runs|experiments)/([^/]+)/(files|results)$`,
  ).exec(pathname)
  if (resourceReadMatch) {
    if (
      (resourceReadMatch[1] === 'runs' && resourceReadMatch[3] !== 'files') ||
      (resourceReadMatch[1] === 'experiments' && resourceReadMatch[3] !== 'results')
    ) {
      return null
    }
    let decodedId: string
    try {
      decodedId = decodeURIComponent(resourceReadMatch[2]!)
    } catch {
      return null
    }
    const resourceId = ResourceIdSchema.safeParse(decodedId)
    if (!resourceId.success) return null
    const key =
      resourceReadMatch[1] === 'runs' ? BACKEND_RUN_FILES_ROUTE : BACKEND_EXPERIMENT_RESULTS_ROUTE
    return { key, methods: BACKEND_ROUTE_ALLOW_LIST[key], resourceId: resourceId.data }
  }
  const experimentBindMatch = new RegExp(`^${prefix}/experiments/([^/]+)/(link|unlink)$`).exec(
    pathname,
  )
  if (experimentBindMatch) {
    let decodedId: string
    try {
      decodedId = decodeURIComponent(experimentBindMatch[1]!)
    } catch {
      return null
    }
    const resourceId = ResourceIdSchema.safeParse(decodedId)
    if (!resourceId.success) return null
    const key =
      experimentBindMatch[2] === 'link'
        ? BACKEND_EXPERIMENT_LINK_ROUTE
        : BACKEND_EXPERIMENT_UNLINK_ROUTE
    return { key, methods: BACKEND_ROUTE_ALLOW_LIST[key], resourceId: resourceId.data }
  }
  const warningMatch = new RegExp(
    `^${prefix}/(runs|experiments)/([^/]+)/warnings(?:/([^/]+))?$`,
  ).exec(pathname)
  if (warningMatch) {
    let id: string
    let row: string | undefined
    try {
      id = decodeURIComponent(warningMatch[2]!)
      row = warningMatch[3] ? decodeURIComponent(warningMatch[3]) : undefined
    } catch {
      return null
    }
    const resource = ResourceIdSchema.safeParse(id)
    if (!resource.success) return null
    if (row && (!/^w_[A-Za-z0-9_.:-]+$/.test(row) || row.length > 128)) return null
    const key =
      warningMatch[1] === 'runs'
        ? row
          ? BACKEND_RUN_WARNING_ROUTE
          : BACKEND_RUN_WARNINGS_ROUTE
        : row
          ? BACKEND_EXPERIMENT_WARNING_ROUTE
          : BACKEND_EXPERIMENT_WARNINGS_ROUTE
    return {
      key,
      methods: BACKEND_ROUTE_ALLOW_LIST[key],
      resourceId: resource.data,
      ...(row ? { warningRowId: row } : {}),
    }
  }
  const mutationMatch = new RegExp(`^${prefix}/(runs|experiments)/([^/]+)/(status|archive)$`).exec(
    pathname,
  )
  if (mutationMatch) {
    let decoded: string
    try {
      decoded = decodeURIComponent(mutationMatch[2]!)
    } catch {
      return null
    }
    const resourceId = ResourceIdSchema.safeParse(decoded)
    if (!resourceId.success) return null
    const key =
      mutationMatch[1] === 'runs'
        ? mutationMatch[3] === 'status'
          ? BACKEND_RUN_STATUS_ROUTE
          : BACKEND_RUN_ARCHIVE_ROUTE
        : mutationMatch[3] === 'status'
          ? BACKEND_EXPERIMENT_STATUS_ROUTE
          : BACKEND_EXPERIMENT_ARCHIVE_ROUTE
    return { key, methods: BACKEND_ROUTE_ALLOW_LIST[key], resourceId: resourceId.data }
  }
  const runMatch = new RegExp(`^${prefix}/runs/([^/]+)$`).exec(pathname)
  const experimentMatch = new RegExp(`^${prefix}/experiments/([^/]+)$`).exec(pathname)
  const resourceMatch = runMatch ?? experimentMatch
  if (resourceMatch?.[1]) {
    let decodedId: string
    try {
      decodedId = decodeURIComponent(resourceMatch[1])
    } catch {
      return null
    }
    const resourceId = ResourceIdSchema.safeParse(decodedId)
    if (!resourceId.success) return null
    const key = runMatch ? BACKEND_RUN_ROUTE : BACKEND_EXPERIMENT_ROUTE
    return { key, methods: BACKEND_ROUTE_ALLOW_LIST[key], resourceId: resourceId.data }
  }
  const reportMatch = new RegExp(`^${prefix}/reports/([^/]+)$`).exec(pathname)
  const codeReviewMatch = new RegExp(`^${prefix}/code-reviews/(.+)$`).exec(pathname)
  const documentMatch = reportMatch ?? codeReviewMatch
  if (documentMatch?.[1]) {
    let decodedId: string
    try {
      decodedId = decodeURIComponent(documentMatch[1])
    } catch {
      return null
    }
    const resourceId = ResourceIdSchema.safeParse(decodedId)
    if (!resourceId.success) return null
    const key = reportMatch ? BACKEND_REPORT_ROUTE : BACKEND_CODE_REVIEW_ROUTE
    if (key === BACKEND_REPORT_ROUTE && !/^R\d{4}$/.test(resourceId.data)) return null
    if (
      key === BACKEND_CODE_REVIEW_ROUTE &&
      !/^(?:code-review|experiments\/E\d{4}-[a-z0-9-]+\/code-review)\/\d{4}-\d{2}-\d{2}-[a-z0-9][a-z0-9-]*$/.test(
        resourceId.data,
      )
    ) {
      return null
    }
    return { key, methods: BACKEND_ROUTE_ALLOW_LIST[key], resourceId: resourceId.data }
  }
  const reportAssetMatch = new RegExp(`^${prefix}/report-assets/([^/]+)/([^/]+)/(.+)$`).exec(
    pathname,
  )
  if (reportAssetMatch?.[1] && reportAssetMatch[2] && reportAssetMatch[3]) {
    let projectInput: string
    let reportId: string
    let resourceInput: string
    try {
      projectInput = decodeURIComponent(reportAssetMatch[1])
      reportId = decodeURIComponent(reportAssetMatch[2])
      resourceInput = reportAssetMatch[3]
        .split('/')
        .map((segment) => decodeURIComponent(segment))
        .join('/')
    } catch {
      return null
    }
    const project = ProjectNameSchema.safeParse(projectInput)
    const resourceId = ResourceIdSchema.safeParse(resourceInput)
    if (!project.success || !/^R\d{4}$/.test(reportId) || !resourceId.success) return null
    return {
      key: BACKEND_REPORT_ASSET_ROUTE,
      methods: BACKEND_ROUTE_ALLOW_LIST[BACKEND_REPORT_ASSET_ROUTE],
      project: project.data,
      reportId,
      resourceId: resourceId.data,
    }
  }
  const wikiBacklinksMatch = new RegExp(`^${prefix}/wiki/backlinks/([^/]+)$`).exec(pathname)
  if (wikiBacklinksMatch?.[1]) {
    let wikiArtifact: string
    try {
      wikiArtifact = decodeURIComponent(wikiBacklinksMatch[1])
    } catch {
      return null
    }
    if (
      wikiArtifact.length === 0 ||
      wikiArtifact.length > 512 ||
      wikiArtifact.includes('/') ||
      wikiArtifact.includes('\\') ||
      wikiArtifact.includes('\0')
    ) {
      return null
    }
    return {
      key: BACKEND_WIKI_BACKLINKS_ROUTE,
      methods: BACKEND_ROUTE_ALLOW_LIST[BACKEND_WIKI_BACKLINKS_ROUTE],
      wikiArtifact,
    }
  }
  const wikiReviewMarkMatch = new RegExp(`^${prefix}/wiki/review/([^/]+)$`).exec(pathname)
  if (wikiReviewMarkMatch?.[1]) {
    let sha: string
    try {
      sha = decodeURIComponent(wikiReviewMarkMatch[1])
    } catch {
      return null
    }
    // `next` is the CLI's "oldest markable commit" alias; core resolves it.
    if (sha !== 'next' && !/^[0-9a-f]{4,40}$/.test(sha)) return null
    return {
      key: BACKEND_WIKI_REVIEW_MARK_ROUTE,
      methods: BACKEND_ROUTE_ALLOW_LIST[BACKEND_WIKI_REVIEW_MARK_ROUTE],
      wikiSha: sha,
    }
  }
  const wikiPageMatch = new RegExp(`^${prefix}/wiki/([^/]+)$`).exec(pathname)
  if (wikiPageMatch?.[1]) {
    let wikiId: string
    try {
      wikiId = decodeURIComponent(wikiPageMatch[1])
    } catch {
      return null
    }
    // Keep the route addressable so the service can return the specified
    // 400 BAD_REQUEST for a non-W wiki identifier.
    return {
      key: BACKEND_WIKI_PAGE_ROUTE,
      methods: BACKEND_ROUTE_ALLOW_LIST[BACKEND_WIKI_PAGE_ROUTE],
      wikiId,
    }
  }
  const wikiAssetMatch = new RegExp(`^${prefix}/wiki-assets/([^/]+)/([^/]+)/(.+)$`).exec(pathname)
  if (wikiAssetMatch?.[1] && wikiAssetMatch[2] && wikiAssetMatch[3]) {
    let projectInput: string
    let wikiId: string
    let resourceInput: string
    try {
      projectInput = decodeURIComponent(wikiAssetMatch[1])
      wikiId = decodeURIComponent(wikiAssetMatch[2])
      resourceInput = wikiAssetMatch[3]
        .split('/')
        .map((segment) => decodeURIComponent(segment))
        .join('/')
    } catch {
      return null
    }
    const project = ProjectNameSchema.safeParse(projectInput)
    const resourceId = ResourceIdSchema.safeParse(resourceInput)
    if (!project.success || !/^W\d{4}$/.test(wikiId) || !resourceId.success) return null
    return {
      key: BACKEND_WIKI_ASSET_ROUTE,
      methods: BACKEND_ROUTE_ALLOW_LIST[BACKEND_WIKI_ASSET_ROUTE],
      project: project.data,
      wikiId,
      resourceId: resourceId.data,
    }
  }
  const gitProjectRoutes = [
    ['git-status', BACKEND_GIT_STATUS_ROUTE],
    ['git-status/files', BACKEND_GIT_STATUS_FILES_ROUTE],
    ['git-branches', BACKEND_GIT_BRANCHES_ROUTE],
    ['git-log', BACKEND_GIT_LOG_ROUTE],
    ['git-commit', BACKEND_GIT_COMMIT_ROUTE],
    ['git-range', BACKEND_GIT_RANGE_ROUTE],
    ['git-diff', BACKEND_GIT_DIFF_ROUTE],
    ['submodules', BACKEND_GIT_SUBMODULES_ROUTE],
    ['commit-marks', BACKEND_GIT_COMMIT_MARKS_ROUTE],
  ] as const
  for (const [suffix, key] of gitProjectRoutes) {
    const match = new RegExp(`^${prefix}/projects/([^/]+)/${suffix.replace('/', '\\/')}$`).exec(
      pathname,
    )
    if (!match?.[1]) continue
    let decodedProject: string
    try {
      decodedProject = decodeURIComponent(match[1])
    } catch {
      return null
    }
    const project = ProjectNameSchema.safeParse(decodedProject)
    if (!project.success) return null
    return { key, methods: BACKEND_ROUTE_ALLOW_LIST[key], project: project.data }
  }
  const commitMarkMatch = new RegExp(`^${prefix}/projects/([^/]+)/commit-marks/([^/]+)$`).exec(
    pathname,
  )
  if (commitMarkMatch?.[1] && commitMarkMatch[2]) {
    let decodedProject: string
    let decodedRef: string
    try {
      decodedProject = decodeURIComponent(commitMarkMatch[1])
      decodedRef = decodeURIComponent(commitMarkMatch[2])
    } catch {
      return null
    }
    const project = ProjectNameSchema.safeParse(decodedProject)
    const gitRef = BackendGitRefSchema.safeParse(decodedRef)
    if (!project.success) return null
    if (!gitRef.success) return null
    return {
      key: BACKEND_GIT_COMMIT_MARK_ROUTE,
      methods: BACKEND_ROUTE_ALLOW_LIST[BACKEND_GIT_COMMIT_MARK_ROUTE],
      project: project.data,
      gitRef: gitRef.data,
    }
  }
  const validationMatch = new RegExp(`^${prefix}/projects/([^/]+)/shares/validate$`).exec(pathname)
  const itemMatch = new RegExp(`^${prefix}/projects/([^/]+)/shares/([^/]+)$`).exec(pathname)
  const collectionMatch = new RegExp(`^${prefix}/projects/([^/]+)/shares$`).exec(pathname)
  const match = validationMatch ?? itemMatch ?? collectionMatch
  if (!match?.[1]) return null
  let decoded: string
  try {
    decoded = decodeURIComponent(match[1])
  } catch {
    return null
  }
  const project = ProjectNameSchema.safeParse(decoded)
  if (!project.success) return null
  if (validationMatch) {
    return {
      key: BACKEND_SHARE_VALIDATE_ROUTE,
      methods: BACKEND_ROUTE_ALLOW_LIST[BACKEND_SHARE_VALIDATE_ROUTE],
      project: project.data,
    }
  }
  if (itemMatch?.[2]) {
    let id: string
    try {
      id = decodeURIComponent(itemMatch[2])
    } catch {
      return null
    }
    if (!/^shr_[A-Za-z0-9_-]+$/.test(id) || id.length > 128) return null
    return {
      key: BACKEND_SHARE_ITEM_ROUTE,
      methods: BACKEND_ROUTE_ALLOW_LIST[BACKEND_SHARE_ITEM_ROUTE],
      project: project.data,
      shareId: id,
    }
  }
  return {
    key: BACKEND_SHARES_ROUTE,
    methods: BACKEND_ROUTE_ALLOW_LIST[BACKEND_SHARES_ROUTE],
    project: project.data,
  }
}

const PROJECT_DATA_ROUTE_KEYS: readonly string[] = [
  BACKEND_RUNS_ROUTE,
  BACKEND_RUN_ROUTE,
  BACKEND_EXPERIMENTS_ROUTE,
  BACKEND_EXPERIMENT_ROUTE,
  BACKEND_RUN_FILES_ROUTE,
  BACKEND_EXPERIMENT_RESULTS_ROUTE,
  BACKEND_HYPOTHESES_ROUTE,
  BACKEND_JOURNAL_ROUTE,
  BACKEND_ANOMALIES_ROUTE,
]

export function isProjectDataRoute(key: string): boolean {
  return PROJECT_DATA_ROUTE_KEYS.includes(key)
}

const DOCUMENT_DATA_ROUTE_KEYS: readonly string[] = [
  BACKEND_REPORTS_ROUTE,
  BACKEND_REPORT_ROUTE,
  BACKEND_CODE_REVIEWS_ROUTE,
  BACKEND_CODE_REVIEW_ROUTE,
  BACKEND_README_ROUTE,
  BACKEND_RUN_README_ROUTE,
  BACKEND_EXPERIMENT_README_ROUTE,
  BACKEND_WIKI_ROUTE,
  BACKEND_WIKI_PAGE_ROUTE,
  BACKEND_WIKI_BACKLINKS_ROUTE,
]

export function isDocumentDataRoute(key: string): boolean {
  return DOCUMENT_DATA_ROUTE_KEYS.includes(key)
}

/**
 * Wiki review marks live in `.memon/wiki-review.csv`, not in Project
 * documents, so they are owner-only shell-class writes that a read-only
 * Backend still accepts.
 */
const WIKI_REVIEW_ROUTE_KEYS: readonly string[] = [
  BACKEND_WIKI_REVIEW_ROUTE,
  BACKEND_WIKI_REVIEW_MARK_ROUTE,
]

export function isWikiReviewRoute(key: string): boolean {
  return WIKI_REVIEW_ROUTE_KEYS.includes(key)
}

const GIT_DATA_ROUTE_KEYS: readonly string[] = [
  BACKEND_GIT_STATUS_ROUTE,
  BACKEND_GIT_STATUS_FILES_ROUTE,
  BACKEND_GIT_BRANCHES_ROUTE,
  BACKEND_GIT_LOG_ROUTE,
  BACKEND_GIT_COMMIT_ROUTE,
  BACKEND_GIT_RANGE_ROUTE,
  BACKEND_GIT_DIFF_ROUTE,
  BACKEND_GIT_SUBMODULES_ROUTE,
  BACKEND_GIT_COMMIT_MARKS_ROUTE,
  BACKEND_GIT_COMMIT_MARK_ROUTE,
  BACKEND_CODE_PREVIEW_ROUTE,
]

export function isGitDataRoute(key: string): boolean {
  return GIT_DATA_ROUTE_KEYS.includes(key)
}

const STREAM_DATA_ROUTE_KEYS: readonly string[] = [
  BACKEND_LOG_FILES_ROUTE,
  BACKEND_LOG_ROUTE,
  BACKEND_LOG_STREAM_ROUTE,
  BACKEND_REPORT_ASSET_ROUTE,
  BACKEND_WIKI_ASSET_ROUTE,
]

export function isStreamDataRoute(key: string): boolean {
  return STREAM_DATA_ROUTE_KEYS.includes(key)
}

function hasSingleValue(search: URLSearchParams, key: string): boolean {
  return search.getAll(key).length === 1
}

function validOptionalSubmodule(search: URLSearchParams): boolean {
  const values = search.getAll('submodule')
  return (
    values.length === 0 || (values.length === 1 && values[0]!.length <= 512 && values[0] !== '')
  )
}

export function routeAllowsQuery(
  route: AllowedBackendRoute,
  method: string,
  search: URLSearchParams,
): boolean {
  const keys = [...search.keys()]
  if (
    [
      BACKEND_RUN_STATUS_ROUTE,
      BACKEND_RUN_ARCHIVE_ROUTE,
      BACKEND_EXPERIMENT_STATUS_ROUTE,
      BACKEND_EXPERIMENT_ARCHIVE_ROUTE,
      BACKEND_RUN_WARNINGS_ROUTE,
      BACKEND_RUN_WARNING_ROUTE,
      BACKEND_EXPERIMENT_WARNINGS_ROUTE,
      BACKEND_EXPERIMENT_WARNING_ROUTE,
      BACKEND_EXPERIMENT_LINK_ROUTE,
      BACKEND_EXPERIMENT_UNLINK_ROUTE,
    ].includes(route.key)
  ) {
    const projects = search.getAll('project')
    return (
      keys.length === 1 &&
      keys[0] === 'project' &&
      projects.length === 1 &&
      ProjectNameSchema.safeParse(projects[0]).success
    )
  }
  if (route.key === BACKEND_SHARES_ROUTE || route.key === BACKEND_SHARE_ITEM_ROUTE) {
    const projects = search.getAll('project')
    if (projects.length > 1 || (projects.length === 1 && projects[0] !== route.project)) {
      return false
    }
    if (route.key === BACKEND_SHARE_ITEM_ROUTE || method !== 'GET') {
      return keys.every((key) => key === 'project')
    }
    const reveal = search.getAll('reveal')
    return (
      reveal.length <= 1 &&
      (reveal.length === 0 || ['true', 'false'].includes(reveal[0]!)) &&
      keys.every((key) => key === 'project' || key === 'reveal')
    )
  }
  if (isProjectDataRoute(route.key)) {
    const projects = search.getAll('project')
    if (projects.length !== 1 || !ProjectNameSchema.safeParse(projects[0]).success) return false
    if (route.key === BACKEND_EXPERIMENT_ROUTE && method === 'DELETE') {
      const force = search.getAll('force')
      return (
        force.length <= 1 &&
        (force.length === 0 || force[0] === 'true' || force[0] === 'false') &&
        keys.every((key) => key === 'project' || key === 'force')
      )
    }
    // `deprecated` is the explicit-inspection selector for the Run
    // collection: absent means the research default (deprecated Runs
    // excluded), `include` adds them, `only` returns just them. Explicit-id
    // Run reads are never filtered, so no other route takes it.
    const inventory = search.getAll('inventory')
    const inventoryRoute =
      route.key === BACKEND_RUNS_ROUTE || route.key === BACKEND_EXPERIMENTS_ROUTE
    if (
      inventory.length > 1 ||
      (inventory.length === 1 && inventory[0] !== '1') ||
      (inventory.length > 0 && !inventoryRoute)
    ) {
      return false
    }
    const allowed =
      route.key === BACKEND_JOURNAL_ROUTE
        ? new Set(['project', 'limit', 'before', 'countOnly'])
        : route.key === BACKEND_RUN_FILES_ROUTE
          ? new Set(['project', 'depth'])
          : route.key === BACKEND_RUNS_ROUTE
            ? new Set(['project', 'deprecated', 'inventory'])
            : route.key === BACKEND_EXPERIMENTS_ROUTE
              ? new Set(['project', 'inventory'])
              : new Set(['project'])
    if (keys.some((key) => !allowed.has(key))) return false
    const deprecated = search.getAll('deprecated')
    if (
      deprecated.length > 1 ||
      (deprecated[0] !== undefined && !['include', 'only'].includes(deprecated[0]))
    ) {
      return false
    }
    if (inventory.length > 0 && deprecated.length > 0) return false
    if (search.getAll('limit').length > 1 || search.getAll('before').length > 1) return false
    const limit = search.get('limit')
    const before = search.get('before')
    const countOnly = search.getAll('countOnly')
    if (limit && !/^\d{1,6}$/.test(limit)) return false
    if (before && before.length > 128) return false
    if (countOnly.length > 1 || (countOnly.length === 1 && countOnly[0] !== '1')) return false
    const depths = search.getAll('depth')
    if (
      depths.length > 1 ||
      (depths[0] !== undefined && !/^[1-6]$/.test(depths[0])) ||
      (route.key !== BACKEND_RUN_FILES_ROUTE && depths.length > 0)
    ) {
      return false
    }
    return true
  }
  if (isDocumentDataRoute(route.key)) {
    const projects = search.getAll('project')
    if (projects.length !== 1 || !ProjectNameSchema.safeParse(projects[0]).success) return false
    const inventoryRoutes: readonly string[] = [
      BACKEND_REPORTS_ROUTE,
      BACKEND_CODE_REVIEWS_ROUTE,
      BACKEND_WIKI_ROUTE,
    ]
    if (inventoryRoutes.includes(route.key)) {
      const inventory = search.getAll('inventory')
      return (
        inventory.length <= 1 &&
        (inventory.length === 0 || inventory[0] === '1') &&
        keys.every((key) => key === 'project' || key === 'inventory')
      )
    }
    if (route.key !== BACKEND_README_ROUTE) {
      return keys.length === 1 && keys[0] === 'project'
    }
    const resources = search.getAll('resource')
    if (resources.length !== 1 || keys.length !== 2) return false
    if (keys.some((key) => key !== 'project' && key !== 'resource')) return false
    const resource = ResourceIdSchema.safeParse(resources[0])
    return (
      resource.success && (resource.data === 'README.md' || resource.data.endsWith('/README.md'))
    )
  }
  if (isGitDataRoute(route.key)) {
    const projects = search.getAll('project')
    if (route.key === BACKEND_CODE_PREVIEW_ROUTE) {
      if (projects.length !== 1 || !ProjectNameSchema.safeParse(projects[0]).success) return false
    } else if (
      !route.project ||
      projects.length > 1 ||
      (projects.length === 1 && projects[0] !== route.project)
    ) {
      return false
    }
    if (!validOptionalSubmodule(search)) return false
    let allowed = new Set(['project'])
    switch (route.key) {
      case BACKEND_GIT_STATUS_ROUTE:
      case BACKEND_GIT_SUBMODULES_ROUTE:
      case BACKEND_GIT_COMMIT_MARKS_ROUTE:
        break
      case BACKEND_GIT_STATUS_FILES_ROUTE:
      case BACKEND_GIT_BRANCHES_ROUTE:
      case BACKEND_GIT_COMMIT_MARK_ROUTE:
        allowed = new Set(['project', 'submodule'])
        break
      case BACKEND_GIT_LOG_ROUTE: {
        allowed = new Set(['project', 'ref', 'limit', 'submodule'])
        if (!hasSingleValue(search, 'ref')) return false
        if (!BackendGitRefSchema.safeParse(search.get('ref')).success) return false
        const limits = search.getAll('limit')
        if (limits.length > 1 || (limits[0] && !/^\d{1,4}$/.test(limits[0]))) return false
        if (limits[0] && (Number(limits[0]) < 1 || Number(limits[0]) > 1000)) return false
        break
      }
      case BACKEND_GIT_COMMIT_ROUTE:
        allowed = new Set(['project', 'sha', 'submodule'])
        if (
          !hasSingleValue(search, 'sha') ||
          !BackendGitRefSchema.safeParse(search.get('sha')).success
        ) {
          return false
        }
        break
      case BACKEND_GIT_RANGE_ROUTE:
        allowed = new Set(['project', 'from', 'to', 'submodule'])
        if (
          !hasSingleValue(search, 'from') ||
          !hasSingleValue(search, 'to') ||
          !BackendGitRefSchema.safeParse(search.get('from')).success ||
          !BackendGitRefSchema.safeParse(search.get('to')).success
        ) {
          return false
        }
        break
      case BACKEND_GIT_DIFF_ROUTE: {
        allowed = new Set(['project', 'path', 'side', 'sha', 'from', 'to', 'submodule'])
        const paths = search.getAll('path')
        const sides = search.getAll('side')
        if (paths.length !== 1 || !ResourceIdSchema.safeParse(paths[0]).success) return false
        if (
          sides.length !== 1 ||
          !['staged', 'unstaged', 'untracked', 'commit', 'range'].includes(sides[0]!)
        ) {
          return false
        }
        if (sides[0] === 'commit') {
          if (
            !hasSingleValue(search, 'sha') ||
            !BackendGitRefSchema.safeParse(search.get('sha')).success ||
            search.has('from') ||
            search.has('to')
          ) {
            return false
          }
        } else if (sides[0] === 'range') {
          if (
            !hasSingleValue(search, 'from') ||
            !hasSingleValue(search, 'to') ||
            !BackendGitRefSchema.safeParse(search.get('from')).success ||
            !BackendGitRefSchema.safeParse(search.get('to')).success ||
            search.has('sha')
          ) {
            return false
          }
        } else if (search.has('sha') || search.has('from') || search.has('to')) return false
        break
      }
      case BACKEND_CODE_PREVIEW_ROUTE: {
        allowed = new Set(['project', 'url'])
        const urls = search.getAll('url')
        if (urls.length !== 1 || urls[0]!.length > 4096) return false
        break
      }
    }
    return keys.every((key) => allowed.has(key))
  }
  if (isWikiReviewRoute(route.key)) {
    const projects = search.getAll('project')
    return (
      keys.length === 1 &&
      keys[0] === 'project' &&
      projects.length === 1 &&
      ProjectNameSchema.safeParse(projects[0]).success
    )
  }
  if (route.key === BACKEND_JOURNAL_HISTORY_ROUTE) {
    const projects = search.getAll('project')
    if (projects.length !== 1 || !ProjectNameSchema.safeParse(projects[0]).success) return false
    if (keys.some((key) => key !== 'project' && key !== 'limit')) return false
    if (search.getAll('limit').length > 1) return false
    const limit = search.get('limit')
    return limit === null || /^\d{1,6}$/.test(limit)
  }
  if (isStreamDataRoute(route.key)) {
    const projects = search.getAll('project')
    if (route.key === BACKEND_REPORT_ASSET_ROUTE || route.key === BACKEND_WIKI_ASSET_ROUTE) {
      return (
        !!route.project &&
        projects.length <= 1 &&
        (projects.length === 0 || projects[0] === route.project) &&
        keys.every((key) => key === 'project')
      )
    }
    if (projects.length !== 1 || !ProjectNameSchema.safeParse(projects[0]).success) return false
    const resources = search.getAll('resource')
    if (resources.length !== 1 || !ResourceIdSchema.safeParse(resources[0]).success) return false
    const allowed =
      route.key === BACKEND_LOG_ROUTE
        ? new Set(['project', 'resource', 'endLine', 'count'])
        : new Set(['project', 'resource'])
    if (keys.some((key) => !allowed.has(key))) return false
    if (route.key !== BACKEND_LOG_ROUTE) return keys.length === 2
    if (search.getAll('endLine').length > 1 || search.getAll('count').length > 1) return false
    const endLine = search.get('endLine')
    const count = search.get('count')
    if (endLine && (!/^\d{1,12}$/.test(endLine) || Number(endLine) < 1)) return false
    if (count && (!/^\d{1,4}$/.test(count) || Number(count) < 1 || Number(count) > 2000)) {
      return false
    }
    return true
  }
  if (route.key === BACKEND_SLURM_STATUS_ROUTE) {
    const projects = search.getAll('project')
    return (
      keys.length === 1 &&
      keys[0] === 'project' &&
      projects.length === 1 &&
      ProjectNameSchema.safeParse(projects[0]).success
    )
  }
  return keys.length === 0
}

export type LegacyPreflight =
  | { outcome: 'not-found' }
  | { outcome: 'method-not-allowed'; route: AllowedBackendRoute; allow: readonly string[] }
  | { outcome: 'read-only'; route: AllowedBackendRoute }
  | { outcome: 'dispatch'; route: AllowedBackendRoute }

/** The legacy handler's routing decisions before dispatch, unchanged. */
export function legacyPreflight(input: {
  method: string
  pathname: string
  search: URLSearchParams
  readOnly: boolean
}): LegacyPreflight {
  const route = resolveAllowedBackendRoute(input.pathname)
  if (!route) return { outcome: 'not-found' }
  const method = input.method
  if (!routeAllowsQuery(route, method, input.search)) return { outcome: 'not-found' }
  if (
    isProjectDataRoute(route.key) &&
    method !== 'GET' &&
    !(
      (route.key === BACKEND_EXPERIMENTS_ROUTE && method === 'POST') ||
      (route.key === BACKEND_EXPERIMENT_ROUTE && method === 'DELETE')
    )
  ) {
    return { outcome: 'not-found' }
  }
  if (!(route.methods as readonly string[]).includes(method)) {
    return { outcome: 'method-not-allowed', route, allow: route.methods }
  }
  if (
    input.readOnly &&
    method !== 'GET' &&
    method !== 'HEAD' &&
    route.key !== BACKEND_SHARE_VALIDATE_ROUTE &&
    route.key !== BACKEND_SHARES_ROUTE &&
    route.key !== BACKEND_SHARE_ITEM_ROUTE &&
    route.key !== BACKEND_WIKI_REVIEW_MARK_ROUTE
  ) {
    return { outcome: 'read-only', route }
  }
  return { outcome: 'dispatch', route }
}

/** The actor route class each legacy dispatch branch authorized with. */
export function legacyRouteClass(key: string, method: string): string {
  if (key === BACKEND_META_PATH || key === BACKEND_EVENTS_PATH) return 'none'
  if (key === BACKEND_PROJECTS_PATH) return 'actor'
  if (
    key === BACKEND_SHARES_ROUTE ||
    key === BACKEND_SHARE_ITEM_ROUTE ||
    key === BACKEND_SHARE_VALIDATE_ROUTE
  ) {
    return 'mutating'
  }
  if (
    (key === BACKEND_EXPERIMENTS_ROUTE && method === 'POST') ||
    (key === BACKEND_EXPERIMENT_ROUTE && method === 'DELETE') ||
    key === BACKEND_EXPERIMENT_LINK_ROUTE ||
    key === BACKEND_EXPERIMENT_UNLINK_ROUTE ||
    key === BACKEND_RUN_STATUS_ROUTE ||
    key === BACKEND_RUN_ARCHIVE_ROUTE ||
    key === BACKEND_EXPERIMENT_STATUS_ROUTE ||
    key === BACKEND_EXPERIMENT_ARCHIVE_ROUTE
  ) {
    return 'mutating'
  }
  if (
    key === BACKEND_RUN_WARNINGS_ROUTE ||
    key === BACKEND_RUN_WARNING_ROUTE ||
    key === BACKEND_EXPERIMENT_WARNINGS_ROUTE ||
    key === BACKEND_EXPERIMENT_WARNING_ROUTE
  ) {
    return method === 'GET' ? 'read' : 'mutating'
  }
  if (isStreamDataRoute(key) || key === BACKEND_SLURM_STATUS_ROUTE) return 'read'
  if (key === BACKEND_JOURNAL_HISTORY_ROUTE || isWikiReviewRoute(key)) return 'shell'
  if (isProjectDataRoute(key)) return 'read'
  if (isDocumentDataRoute(key) || isGitDataRoute(key)) return method === 'GET' ? 'read' : 'mutating'
  throw new Error(`unclassified legacy route ${key}`)
}
