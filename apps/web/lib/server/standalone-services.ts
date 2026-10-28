import 'server-only'

import {
  BackendMutationError,
  BackendProjectServiceError,
  type BackendSlurmService,
  CENTRAL_READ_POLICY,
  createBackendSlurmService,
  enableDerivedIndex,
  FilesystemDocumentService,
  FilesystemGitService,
  FilesystemMutationService,
  FilesystemProjectService,
  FilesystemStreamService,
  resolveProjectExecution,
} from '@memon/backend'
import {
  type Config,
  configureFileAgentAdapters,
  getProjectFileContext,
  type ProjectEditKind,
  parseFileOperationReason,
  prepareProjectFileAccess,
  projectSourceGroup,
  withFileWriterLock,
  withProjectFileContext,
} from '@memon/core'
import { isCollectionResourcePath } from '../resource-policy'
import { readIdentityFromRequest } from './auth/request-context'
import { standaloneRequestContext } from './standalone-request-context'

export const STANDALONE_SERVICE_MIGRATION = {
  projectReads: 'shared',
  documents: 'shared',
  mutations: 'shared',
  git: 'shared',
  streaming: 'shared',
  slurm: 'shared',
  runtimeCaches: 'shared-file-observations',
  runtimePoller: 'shared-conditional-observations',
  runtimeSse: 'resource-polling',
} as const

export interface StandaloneServices {
  projects: FilesystemProjectService
  documents: FilesystemDocumentService
  mutations: FilesystemMutationService
  git: FilesystemGitService
  streaming: FilesystemStreamService
  slurm: BackendSlurmService | null
}

const servicesByConfig = new WeakMap<Config, StandaloneServices>()

/**
 * One framework-neutral service composition per live standalone Config.
 * Next route adapters may retain legacy absolute-path response fields, but
 * filesystem/Git/mutation semantics come from the same implementations used
 * by independently deployed Backends.
 */
export function standaloneServices(config: Config): StandaloneServices {
  const existing = servicesByConfig.get(config)
  if (existing) return existing
  configureFileAgentAdapters(config.fileAgents ?? {}, config.projects)
  const projects = config.projects.filter((project) => project.host === undefined)
  enableDerivedIndex(projects, { validator: process.env.MEMON_INDEX_VALIDATOR !== 'off' })
  const services: StandaloneServices = {
    projects: scopeService(
      config,
      new FilesystemProjectService(projects, { readPolicy: CENTRAL_READ_POLICY }),
      'projects',
    ),
    documents: scopeService(
      config,
      new FilesystemDocumentService(projects, {
        readPolicy: CENTRAL_READ_POLICY,
        indexRole: 'central',
      }),
      'documents',
    ),
    mutations: scopeService(
      config,
      new FilesystemMutationService(projects, undefined, { indexRole: 'central' }),
      'mutations',
    ),
    git: scopeService(
      config,
      new FilesystemGitService(projects, { trustedConfiguredPaths: true }),
      'git',
    ),
    streaming: scopeService(config, new FilesystemStreamService(projects), 'streaming'),
    slurm: projects.some((project) => project.execution !== undefined)
      ? createBackendSlurmService({
          totalNodes: config.slurm?.totalNodes ?? -1,
          execution: resolveProjectExecution(
            projects.find((project) => project.execution !== undefined)!,
          ),
        })
      : null,
  }
  servicesByConfig.set(config, services)
  return services
}

/** Both URL families select the same primitive context; host never selects I/O. */
export function withStandaloneProject<T>(
  config: Config,
  name: string,
  work: () => Promise<T>,
  write = false,
  control = false,
  edit?: ProjectEditKind,
): Promise<T> {
  const matches = config.projects.filter(
    (project) => project.host === undefined && project.name === name,
  )
  if (matches.length !== 1)
    throw new BackendProjectServiceError(
      'PROJECT_NOT_FOUND',
      'Project selector is unknown or ambiguous',
    )
  const project = matches[0]!
  const parent = getProjectFileContext()
  const scope = standaloneRequestContext()
  if (scope) {
    const identity = readIdentityFromRequest(scope.request)
    if (identity.role === 'viewer' && !identity.scopeProjects.has(name))
      throw new BackendMutationError('FORBIDDEN', 'Project is outside the viewer scope')
    scope.projects.set(project.root, project)
  }
  const requestedReason =
    scope && !isCollectionResourcePath(new URL(scope.request.url).pathname)
      ? parseFileOperationReason(scope.request.headers.get('x-memon-reason'))
      : undefined
  return withProjectFileContext(
    {
      root: project.root,
      storage: project.storage,
      storageGroup: projectSourceGroup(project),
      cachePolicy: project.access?.cache,
      sourceIdentity: project.access?.kind === 'agent' ? project.access.sourceIdentity : undefined,
      reason: write ? 'write' : (parent?.reason ?? requestedReason ?? 'automatic'),
      observationPolicy: control || write ? 'revalidate' : parent?.observationPolicy,
      // An allowed bounded edit (`allowed_edits`) is the only write a
      // read-only Project admits; its File Agent grant still bounds it.
      readOnly:
        !control &&
        project.readOnly === true &&
        !(edit !== undefined && project.allowedEdits?.includes(edit)),
      persistentCache: !control && project.persistentCache === true,
      attentionId: parent?.attentionId ?? scope?.attentionId,
    },
    async () => {
      await prepareProjectFileAccess()
      return write ? withFileWriterLock(project.root, work) : work()
    },
  )
}

/** Document methods that make the bounded `title` edit. */
const TITLE_EDITS = new Set(['setReportTitle', 'setWikiTitle'])

/** Project methods are scoped individually; lazy iterator pulls retain that scope. */
function scopeService<T extends object>(config: Config, service: T, kind: string): T {
  return new Proxy(service, {
    get(target, key, receiver) {
      const value: unknown = Reflect.get(target, key, receiver)
      if (typeof value !== 'function' || key === 'constructor') return value
      return (...args: unknown[]) => {
        const nameIndex =
          kind === 'mutations' &&
          ['bindExperiment', 'mutateWarning', 'listWarnings'].includes(String(key))
            ? 1
            : 0
        const name = args[nameIndex]
        const invoke = () => Reflect.apply(value, target, args)
        // These are memory-only diagnostics, not source operations.
        if (['inspectProject', 'invalidateProject'].includes(String(key))) return invoke()
        if (kind === 'streaming' && (key === 'openByteStream' || key === 'closeByteResource')) {
          const resource = args[0] as { project: string; absolutePath: string }
          const project = config.projects.find(
            (entry) => entry.host === undefined && entry.name === resource.project,
          )
          if (!project) throw new Error('Stream authority is not configured')
          const scope = standaloneRequestContext()
          if (scope) {
            const identity = readIdentityFromRequest(scope.request)
            if (identity.role === 'viewer' && !identity.scopeProjects.has(project.name))
              throw new BackendMutationError('FORBIDDEN', 'Project is outside the viewer scope')
            scope.projects.set(project.root, project)
          }
          return withProjectFileContext(
            {
              root: project.root,
              storage: project.storage,
              storageGroup: projectSourceGroup(project),
              cachePolicy: project.access?.cache,
              reason: 'automatic',
              readOnly: true,
            },
            invoke,
          )
        }
        if (typeof name !== 'string') throw new Error('Project selector is required')
        const write =
          (kind === 'mutations' && key !== 'listWarnings' && key !== 'getExperimentResearch') ||
          /^(put|patch|mark|unmark|set|delete)/.test(String(key)) ||
          (kind === 'shares' && ['add', 'revoke'].includes(String(key)))
        const control = kind === 'shares'
        const edit =
          kind === 'documents' && TITLE_EDITS.has(String(key)) ? ('title' as const) : undefined
        const run = <R>(work: () => Promise<R>) =>
          withStandaloneProject(config, name, work, write, control, edit)
        if (kind === 'streaming' && key === 'streamLog') {
          const iterator = invoke() as AsyncIterableIterator<unknown>
          return {
            [Symbol.asyncIterator]() {
              return this
            },
            next: () => run(() => iterator.next()),
            return: () =>
              run(() =>
                iterator.return
                  ? iterator.return()
                  : Promise.resolve({ done: true as const, value: undefined }),
              ),
          }
        }
        return run(async () => {
          const context = getProjectFileContext()
          if (context && ['getExperimentResults', 'getExperimentResearch'].includes(String(key))) {
            // Snapshot and lock reads promise fresh inputs, even without a browser reason header.
            return withProjectFileContext(
              { ...context, reason: 'manual', observationPolicy: 'revalidate' },
              async () => invoke(),
            )
          }
          return invoke()
        })
      }
    },
  })
}

/** Legacy list adapters filter before source work, including mixed namespace instances. */
export function standaloneProjects(config: Config, request: Request) {
  const { role, scopeProjects } = readIdentityFromRequest(request)
  const selected = new URL(request.url).searchParams.get('project')
  return config.projects.filter(
    (project) =>
      project.host === undefined &&
      (!selected || project.name === selected) &&
      (role !== 'viewer' || scopeProjects.has(project.name)),
  )
}
