import {
  type BackendSlurmService,
  createBackendSlurmService,
  FilesystemDocumentService,
  FilesystemGitService,
  FilesystemMutationService,
  FilesystemProjectService,
  FilesystemStreamService,
  LocalBackendTerminalService,
} from '@memon/backend'
import {
  addShare,
  type Config,
  listShares,
  revokeShare,
  type ShareRecord,
  validateShare,
} from '@memon/core'
import { runSqueueMe } from '../slurm/squeue'

export const STANDALONE_SERVICE_MIGRATION = {
  projectReads: 'shared',
  documents: 'shared',
  mutations: 'shared',
  git: 'shared',
  streaming: 'shared',
  slurm: 'shared',
  shares: 'shared-core-adapter',
  runtimeCaches: 'legacy-runtime-required',
  runtimePoller: 'legacy-runtime-required',
  runtimeSse: 'legacy-runtime-required',
  terminalBinary: 'shared',
  tmux: 'shared',
  herdr: 'shared',
} as const

export interface StandaloneServices {
  projects: FilesystemProjectService
  documents: FilesystemDocumentService
  mutations: FilesystemMutationService
  git: FilesystemGitService
  streaming: FilesystemStreamService
  slurm: BackendSlurmService | null
  terminal(): LocalBackendTerminalService
  shares: {
    list(project: string, includeTokens: boolean): Promise<ShareRecord[]>
    add(project: string, input: { label?: string; expires?: string }): Promise<ShareRecord>
    revoke(project: string, id: string): Promise<ShareRecord[]>
    validate(project: string, token: string): Promise<boolean>
  }
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
  const projectRoot = (name: string): string => {
    const project = config.projects.find((candidate) => candidate.name === name)
    if (!project) throw new Error('Project is not configured')
    return project.root
  }
  let terminalService: LocalBackendTerminalService | null = null
  const services: StandaloneServices = {
    projects: new FilesystemProjectService(config.projects),
    documents: new FilesystemDocumentService(config.projects),
    mutations: new FilesystemMutationService(config.projects),
    git: new FilesystemGitService(config.projects, { trustedConfiguredPaths: true }),
    streaming: new FilesystemStreamService(config.projects),
    slurm: createBackendSlurmService({
      totalNodes: config.slurm?.totalNodes ?? -1,
      provider: runSqueueMe,
    }),
    terminal: () => {
      terminalService ??= new LocalBackendTerminalService({
        hostId: 'standalone',
        projects: config.projects,
        terminal: config.terminal,
        standaloneProxyPaths: true,
        standaloneTargetFallback: true,
      })
      return terminalService
    },
    shares: {
      list: (project, includeTokens) => listShares(projectRoot(project), { includeTokens }),
      add: (project, input) => addShare(projectRoot(project), input),
      revoke: (project, id) => revokeShare(projectRoot(project), id),
      validate: async (project, token) =>
        (await validateShare(projectRoot(project), token).catch(() => null)) !== null,
    },
  }
  servicesByConfig.set(config, services)
  return services
}
