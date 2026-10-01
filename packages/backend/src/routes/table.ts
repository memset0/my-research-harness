// The declarative Backend route table (metadata). Path, parameters, query,
// methods, route class and read-only policy for every route live here once.

import { BackendGitRefSchema, ProjectNameSchema, ResourceIdSchema } from '@memon/core'
import {
  BACKEND_ANOMALIES_ROUTE,
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
} from '../http/paths.js'
import {
  anyValue,
  type BackendRouteSpec,
  emptyOr,
  integerIn,
  matches,
  oneOf,
  type QueryField,
  type QuerySpec,
  type RouteOperationPolicy,
  schemaCheck,
} from '../http/route.js'

// --- parameter parsers -----------------------------------------------------

const parse =
  (check: (value: string) => boolean) =>
  (value: string): string | null =>
    check(value) ? value : null
const projectParam = parse(schemaCheck(ProjectNameSchema))
const resourceParam = parse(schemaCheck(ResourceIdSchema))
const reportIdParam = parse(
  (value) => schemaCheck(ResourceIdSchema)(value) && /^R\d{4}$/.test(value),
)
const codeReviewIdParam = parse(
  (value) =>
    schemaCheck(ResourceIdSchema)(value) &&
    /^(?:code-review|experiments\/E\d{4}-[a-z0-9-]+\/code-review)\/\d{4}-\d{2}-\d{2}-[a-z0-9][a-z0-9-]*$/.test(
      value,
    ),
)
const warningRowParam = parse((value) => /^w_[A-Za-z0-9_.:-]+$/.test(value) && value.length <= 128)
const shareIdParam = parse((value) => /^shr_[A-Za-z0-9_-]+$/.test(value) && value.length <= 128)
const gitRefParam = parse(schemaCheck(BackendGitRefSchema))
const wikiArtifactParam = parse(
  (value) =>
    value.length > 0 &&
    value.length <= 512 &&
    !value.includes('/') &&
    !value.includes('\\') &&
    !value.includes('\0'),
)
// `next` is the CLI's "oldest markable commit" alias; core resolves it.
const wikiShaParam = parse((value) => value === 'next' || /^[0-9a-f]{4,40}$/.test(value))
// Any decoded id stays addressable so the service answers 400 for a non-W id.
const wikiIdParam = (value: string) => value

// --- query declarations ----------------------------------------------------

const projectField: QueryField = { check: schemaCheck(ProjectNameSchema), required: true }
const optional = (check: (value: string) => boolean): QueryField => ({ check })
const required = (check: (value: string) => boolean): QueryField => ({ check, required: true })
const NO_QUERY: QuerySpec = { fields: {} }
/** Exactly one valid `project` selector plus the given fields. */
const projectQuery = (fields: Record<string, QueryField> = {}, refine?: QuerySpec['refine']) => ({
  fields: { project: projectField, ...fields },
  ...(refine ? { refine } : {}),
})
/** The Project comes from the path; a `project` query, if present, must repeat it. */
const pathProjectQuery = (
  fields: Record<string, QueryField> = {},
  refine?: QuerySpec['refine'],
) => ({
  fields: { project: optional(anyValue), ...fields },
  refine: (
    values: Readonly<Record<string, string>>,
    input: Parameters<NonNullable<QuerySpec['refine']>>[1],
  ) =>
    (values.project === undefined || values.project === input.params.project) &&
    (refine ? refine(values, input) : true),
})
const inventoryField = optional(oneOf('1'))
const submoduleField = optional((value) => value !== '' && value.length <= 512)
const gitRefField = (isRequired: boolean) =>
  isRequired
    ? required(schemaCheck(BackendGitRefSchema))
    : optional(schemaCheck(BackendGitRefSchema))

// --- operation policies ------------------------------------------------------

const read: RouteOperationPolicy = { routeClass: 'read', readOnly: 'refuse' }
const mutating: RouteOperationPolicy = { routeClass: 'mutating', readOnly: 'refuse' }
const shell: RouteOperationPolicy = { routeClass: 'shell', readOnly: 'refuse' }
/** Owner control writes over `.memon/` state: allowed on a read-only Backend. */
const controlMutating: RouteOperationPolicy = { routeClass: 'mutating', readOnly: 'allow' }
const controlShell: RouteOperationPolicy = { routeClass: 'shell', readOnly: 'allow' }

const id = { id: resourceParam }
const projectParams = { project: projectParam }

export const BACKEND_ROUTE_SPECS: readonly BackendRouteSpec[] = [
  // --- instance, Project discovery, shares, Slurm
  {
    key: BACKEND_META_PATH,
    query: NO_QUERY,
    operations: { GET: { routeClass: 'none', readOnly: 'refuse' } },
  },
  {
    key: BACKEND_EVENTS_PATH,
    query: NO_QUERY,
    operations: { GET: { routeClass: 'none', readOnly: 'refuse' } },
  },
  {
    key: BACKEND_PROJECTS_PATH,
    query: NO_QUERY,
    operations: { GET: { routeClass: 'actor', readOnly: 'refuse' } },
  },
  {
    key: BACKEND_SHARE_VALIDATE_ROUTE,
    params: projectParams,
    query: NO_QUERY,
    operations: { POST: controlMutating },
  },
  {
    key: BACKEND_SHARES_ROUTE,
    params: projectParams,
    query: (method) =>
      method === 'GET'
        ? pathProjectQuery({ reveal: optional(oneOf('true', 'false')) })
        : pathProjectQuery(),
    operations: { GET: controlMutating, POST: controlMutating },
  },
  {
    key: BACKEND_SHARE_ITEM_ROUTE,
    params: { ...projectParams, id: shareIdParam },
    query: pathProjectQuery(),
    operations: { DELETE: controlMutating },
  },
  { key: BACKEND_SLURM_STATUS_ROUTE, query: projectQuery(), operations: { GET: read } },

  // --- Run / Experiment data and mutations
  {
    key: BACKEND_RUNS_ROUTE,
    query: projectQuery(
      { deprecated: optional(oneOf('include', 'only')), inventory: inventoryField },
      (values) => !(values.inventory !== undefined && values.deprecated !== undefined),
    ),
    unknownMethod: 'not-found',
    operations: { GET: read },
  },
  {
    key: BACKEND_RUN_ROUTE,
    params: id,
    query: projectQuery(),
    unknownMethod: 'not-found',
    operations: { GET: read },
  },
  {
    key: BACKEND_EXPERIMENTS_ROUTE,
    query: projectQuery({ inventory: inventoryField }),
    unknownMethod: 'not-found',
    operations: { GET: read, POST: mutating },
  },
  {
    key: BACKEND_EXPERIMENT_ROUTE,
    params: id,
    query: (method) =>
      method === 'DELETE'
        ? projectQuery({ force: optional(oneOf('true', 'false')) })
        : projectQuery(),
    unknownMethod: 'not-found',
    operations: { GET: read, DELETE: mutating },
  },
  {
    key: BACKEND_RUN_FILES_ROUTE,
    params: id,
    query: projectQuery({ depth: optional(matches(/^[1-6]$/)) }),
    unknownMethod: 'not-found',
    operations: { GET: read },
  },
  {
    key: BACKEND_EXPERIMENT_RESULTS_ROUTE,
    params: id,
    query: projectQuery(),
    unknownMethod: 'not-found',
    operations: { GET: read },
  },
  {
    key: BACKEND_HYPOTHESES_ROUTE,
    query: projectQuery(),
    unknownMethod: 'not-found',
    operations: { GET: read },
  },
  {
    key: BACKEND_JOURNAL_ROUTE,
    query: projectQuery({
      limit: optional(emptyOr(matches(/^\d{1,6}$/))),
      before: optional((value) => value.length <= 128),
      countOnly: optional(oneOf('1')),
    }),
    unknownMethod: 'not-found',
    operations: { GET: read },
  },
  {
    key: BACKEND_JOURNAL_HISTORY_ROUTE,
    query: projectQuery({ limit: optional(matches(/^\d{1,6}$/)) }),
    operations: { GET: shell },
  },
  {
    key: BACKEND_ANOMALIES_ROUTE,
    query: projectQuery(),
    unknownMethod: 'not-found',
    operations: { GET: read },
  },
  {
    key: BACKEND_RUN_STATUS_ROUTE,
    params: id,
    query: projectQuery(),
    operations: { PATCH: mutating },
  },
  {
    key: BACKEND_RUN_ARCHIVE_ROUTE,
    params: id,
    query: projectQuery(),
    operations: { PATCH: mutating },
  },
  {
    key: BACKEND_EXPERIMENT_STATUS_ROUTE,
    params: id,
    query: projectQuery(),
    operations: { PATCH: mutating },
  },
  {
    key: BACKEND_EXPERIMENT_ARCHIVE_ROUTE,
    params: id,
    query: projectQuery(),
    operations: { PATCH: mutating },
  },
  {
    key: BACKEND_RUN_WARNINGS_ROUTE,
    params: id,
    query: projectQuery(),
    operations: { GET: read, POST: mutating },
  },
  {
    key: BACKEND_RUN_WARNING_ROUTE,
    params: { ...id, rowId: warningRowParam },
    query: projectQuery(),
    operations: { PATCH: mutating, DELETE: mutating },
  },
  {
    key: BACKEND_EXPERIMENT_WARNINGS_ROUTE,
    params: id,
    query: projectQuery(),
    operations: { GET: read, POST: mutating },
  },
  {
    key: BACKEND_EXPERIMENT_WARNING_ROUTE,
    params: { ...id, rowId: warningRowParam },
    query: projectQuery(),
    operations: { PATCH: mutating, DELETE: mutating },
  },
  {
    key: BACKEND_EXPERIMENT_LINK_ROUTE,
    params: id,
    query: projectQuery(),
    operations: { POST: mutating },
  },
  {
    key: BACKEND_EXPERIMENT_UNLINK_ROUTE,
    params: id,
    query: projectQuery(),
    operations: { POST: mutating },
  },

  // --- documents and Wiki
  {
    key: BACKEND_REPORTS_ROUTE,
    query: projectQuery({ inventory: inventoryField }),
    operations: { GET: read },
  },
  {
    key: BACKEND_REPORT_ROUTE,
    params: { id: reportIdParam },
    query: projectQuery(),
    operations: { GET: read, PUT: mutating },
  },
  {
    key: BACKEND_CODE_REVIEWS_ROUTE,
    query: projectQuery({ inventory: inventoryField }),
    operations: { GET: read },
  },
  {
    key: BACKEND_CODE_REVIEW_ROUTE,
    params: { id: codeReviewIdParam },
    query: projectQuery(),
    operations: { GET: read, PATCH: mutating },
  },
  {
    key: BACKEND_README_ROUTE,
    query: projectQuery({
      resource: required(
        (value) =>
          schemaCheck(ResourceIdSchema)(value) &&
          (value === 'README.md' || value.endsWith('/README.md')),
      ),
    }),
    operations: { GET: read, PUT: mutating },
  },
  {
    key: BACKEND_RUN_README_ROUTE,
    params: id,
    query: projectQuery(),
    operations: { GET: read, PUT: mutating },
  },
  {
    key: BACKEND_EXPERIMENT_README_ROUTE,
    params: id,
    query: projectQuery(),
    operations: { GET: read, PUT: mutating },
  },
  {
    key: BACKEND_WIKI_ROUTE,
    query: projectQuery({ inventory: inventoryField }),
    operations: { GET: read },
  },
  {
    key: BACKEND_WIKI_PAGE_ROUTE,
    params: { id: wikiIdParam },
    query: projectQuery(),
    operations: { GET: read, PUT: mutating },
  },
  {
    key: BACKEND_WIKI_BACKLINKS_ROUTE,
    params: { artifact: wikiArtifactParam },
    query: projectQuery(),
    operations: { GET: read },
  },
  // Review marks record human trust in `.memon/`, not Project content.
  { key: BACKEND_WIKI_REVIEW_ROUTE, query: projectQuery(), operations: { GET: shell } },
  {
    key: BACKEND_WIKI_REVIEW_MARK_ROUTE,
    params: { sha: wikiShaParam },
    query: projectQuery(),
    operations: { POST: controlShell, DELETE: controlShell },
  },

  // --- Git
  {
    key: BACKEND_GIT_STATUS_ROUTE,
    params: projectParams,
    query: pathProjectQuery(),
    operations: { GET: read },
  },
  {
    key: BACKEND_GIT_STATUS_FILES_ROUTE,
    params: projectParams,
    query: pathProjectQuery({ submodule: submoduleField }),
    operations: { GET: read },
  },
  {
    key: BACKEND_GIT_BRANCHES_ROUTE,
    params: projectParams,
    query: pathProjectQuery({ submodule: submoduleField }),
    operations: { GET: read },
  },
  {
    key: BACKEND_GIT_LOG_ROUTE,
    params: projectParams,
    query: pathProjectQuery({
      ref: gitRefField(true),
      limit: optional(emptyOr(integerIn(/^\d{1,4}$/, 1, 1000))),
      submodule: submoduleField,
    }),
    operations: { GET: read },
  },
  {
    key: BACKEND_GIT_COMMIT_ROUTE,
    params: projectParams,
    query: pathProjectQuery({ sha: gitRefField(true), submodule: submoduleField }),
    operations: { GET: read },
  },
  {
    key: BACKEND_GIT_RANGE_ROUTE,
    params: projectParams,
    query: pathProjectQuery({
      from: gitRefField(true),
      to: gitRefField(true),
      submodule: submoduleField,
    }),
    operations: { GET: read },
  },
  {
    key: BACKEND_GIT_DIFF_ROUTE,
    params: projectParams,
    query: pathProjectQuery(
      {
        path: required(schemaCheck(ResourceIdSchema)),
        side: required(oneOf('staged', 'unstaged', 'untracked', 'commit', 'range')),
        sha: gitRefField(false),
        from: gitRefField(false),
        to: gitRefField(false),
        submodule: submoduleField,
      },
      ({ side, sha, from, to }) =>
        side === 'commit'
          ? sha !== undefined && from === undefined && to === undefined
          : side === 'range'
            ? from !== undefined && to !== undefined && sha === undefined
            : sha === undefined && from === undefined && to === undefined,
    ),
    operations: { GET: read },
  },
  {
    key: BACKEND_GIT_SUBMODULES_ROUTE,
    params: projectParams,
    query: pathProjectQuery(),
    operations: { GET: read },
  },
  {
    key: BACKEND_GIT_COMMIT_MARKS_ROUTE,
    params: projectParams,
    query: pathProjectQuery(),
    operations: { GET: read },
  },
  {
    key: BACKEND_GIT_COMMIT_MARK_ROUTE,
    params: { ...projectParams, sha: gitRefParam },
    query: pathProjectQuery({ submodule: submoduleField }),
    operations: { PUT: mutating, DELETE: mutating },
  },
  {
    key: BACKEND_CODE_PREVIEW_ROUTE,
    query: projectQuery({ url: required((value) => value.length <= 4096) }),
    operations: { GET: read },
  },

  // --- logs and byte assets
  {
    key: BACKEND_LOG_FILES_ROUTE,
    query: projectQuery({ resource: required(schemaCheck(ResourceIdSchema)) }),
    operations: { GET: read },
  },
  {
    key: BACKEND_LOG_ROUTE,
    query: projectQuery({
      resource: required(schemaCheck(ResourceIdSchema)),
      endLine: optional(emptyOr(integerIn(/^\d{1,12}$/, 1, Number.MAX_SAFE_INTEGER))),
      count: optional(emptyOr(integerIn(/^\d{1,4}$/, 1, 2000))),
    }),
    operations: { GET: read },
  },
  {
    key: BACKEND_LOG_STREAM_ROUTE,
    query: projectQuery({ resource: required(schemaCheck(ResourceIdSchema)) }),
    operations: { GET: read },
  },
  {
    key: BACKEND_REPORT_ASSET_ROUTE,
    params: { ...projectParams, id: parse((value) => /^R\d{4}$/.test(value)), path: resourceParam },
    query: pathProjectQuery(),
    operations: { GET: read, HEAD: read },
  },
  {
    key: BACKEND_WIKI_ASSET_ROUTE,
    params: { ...projectParams, id: parse((value) => /^W\d{4}$/.test(value)), path: resourceParam },
    query: pathProjectQuery(),
    operations: { GET: read, HEAD: read },
  },
]
