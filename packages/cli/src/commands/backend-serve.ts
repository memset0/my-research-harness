import { randomUUID } from 'node:crypto'
import type { Server } from 'node:http'
import { hostname } from 'node:os'
import { isAbsolute, join, resolve } from 'node:path'
import {
  BackendEventStream,
  BackendFilesystemMonitor,
  type BackendServerOptions,
  createBackendServer,
  createBackendSlurmService,
  FilesystemDocumentService,
  FilesystemGitService,
  FilesystemMutationService,
  FilesystemProjectService,
  FilesystemStreamService,
  LocalBackendTerminalService,
  preflightBackendStart,
} from '@memon/backend'
import {
  addShare,
  type BackendCapabilities,
  type Config,
  ConfigError,
  isProtectedExampleConfigPath,
  listShares,
  loadConfig,
  MEMON_RELEASE,
  MEMON_REVISION,
  revokeShare,
  validateShare,
} from '@memon/core'

export interface BackendServeOptions {
  cwd: string
  configPath?: string
  format: 'json' | 'human'
}

export interface BackendServeStatus {
  action: 'backend-serve'
  outcome: 'listening'
  host: string
  bind: { address: string; port: number }
  release: string
  revision: string
  configPath: string
  capabilities: BackendCapabilities
}

export interface BackendServeResult {
  server: Server
  status: BackendServeStatus
}

export interface BackendServeDependencies {
  serverFactory?: (options: BackendServerOptions) => Server
  writeOutput?: (text: string) => void
}

export function backendCapabilitiesFromConfig(config: Config): BackendCapabilities {
  const readOnly = config.backend?.accessMode === 'read_only'
  const tmux = config.terminal.tmuxEnabled
  const herdr = config.terminal.herdr !== undefined
  return {
    projects: true,
    mutations: !readOnly,
    events: true,
    logStreaming: true,
    reportAssets: true,
    git: true,
    shares: true,
    tmux: !readOnly && tmux,
    terminal: !readOnly && (tmux || herdr),
    slurm: !readOnly && config.slurm.totalNodes > 0,
    herdr: !readOnly && herdr,
  }
}

function selectedConfigPath(options: BackendServeOptions): string {
  if (!options.configPath) return join(resolve(options.cwd), 'config.yml')
  return isAbsolute(options.configPath)
    ? options.configPath
    : resolve(options.cwd, options.configPath)
}

async function listen(server: Server, address: string, port: number): Promise<void> {
  await new Promise<void>((resolveListen, reject) => {
    const onError = (error: Error) => {
      server.off('error', onError)
      reject(error)
    }
    server.once('error', onError)
    server.listen(port, address, () => {
      server.off('error', onError)
      resolveListen()
    })
  })
}

function renderStatus(status: BackendServeStatus, format: BackendServeOptions['format']): string {
  if (format === 'json') return `${JSON.stringify(status)}\n`
  return `${[
    `memon Backend ${status.host} listening on ${status.bind.address}:${status.bind.port}`,
    `release ${status.release} (${status.revision})`,
    `config ${status.configPath}`,
  ].join(' · ')}\n`
}

/** Start the canonical framework-neutral Backend entry from one instance config. */
export async function runBackendServe(
  options: BackendServeOptions,
  dependencies: BackendServeDependencies = {},
): Promise<BackendServeResult> {
  const configPath = selectedConfigPath(options)
  if (isProtectedExampleConfigPath(configPath)) {
    throw new ConfigError(
      'config.example.yml is a protected template and cannot be used as a Backend instance',
      configPath,
    )
  }

  const config = await loadConfig({ cwd: options.cwd, explicitPath: configPath })
  if (!config) throw new ConfigError('Backend instance configuration was not found', configPath)
  if (!config.backend) {
    throw new ConfigError('selected instance must contain a `backend:` role block', configPath)
  }
  if (config.auth) {
    // The config loader already rejects this combination. Keep the canonical
    // entry fail-closed if a future loader or injected Config widens it.
    throw new ConfigError(
      'Backend instances must not contain human `auth:` credentials',
      configPath,
    )
  }

  const capabilities = backendCapabilitiesFromConfig(config)
  const runningRelease = process.env.MEMON_RELEASE?.trim() || MEMON_RELEASE
  const runningRevision = process.env.MEMON_REVISION?.trim() || MEMON_REVISION
  await preflightBackendStart({
    guards: config.backend.daemon.guards,
    hostname: hostname(),
    environment: process.env,
    runtimeDir: config.backend.daemon.runtimeDir,
    runtimePolicy: {
      stateDir: config.backend.daemon.stateDir,
      releaseDir: config.backend.daemon.releaseDir,
      forbiddenSharedRoots: config.projects.map((project) => project.root),
    },
  })
  const terminalService = capabilities.terminal
    ? new LocalBackendTerminalService({
        hostId: config.backend.hostId,
        projects: config.projects,
        terminal: config.terminal,
      })
    : undefined
  const instanceEpoch = randomUUID()
  const eventStream = new BackendEventStream({ instanceEpoch })
  const projectService = new FilesystemProjectService(config.projects)
  const filesystemMonitor = new BackendFilesystemMonitor({
    projects: config.projects,
    eventStream,
    minIntervalMs: config.poll.minIntervalMs,
    maxIntervalMs: config.poll.maxIntervalMs,
    backoffFactor: config.poll.backoffFactor,
    refreshProject: (projectName) => projectService.refreshProject(projectName),
  })
  const server = (dependencies.serverFactory ?? createBackendServer)({
    hostId: config.backend.hostId,
    serviceTokens: config.backend.tokens,
    capabilities,
    instanceEpoch,
    eventStream,
    filesystemMonitor,
    readOnly: config.backend.accessMode === 'read_only',
    slurmService:
      config.backend.accessMode === 'read_only'
        ? null
        : createBackendSlurmService({ totalNodes: config.slurm.totalNodes }),
    release: runningRelease,
    revision: runningRevision,
    projectDiscovery: () => config.projects.map((project) => ({ name: project.name })),
    documentService: new FilesystemDocumentService(config.projects),
    gitService: new FilesystemGitService(config.projects),
    projectService,
    streamService: new FilesystemStreamService(config.projects),
    mutationService: new FilesystemMutationService(config.projects),
    ...(terminalService ? { terminalService } : {}),
    shareValidator: async (projectName, token) => {
      const project = config.projects.find((candidate) => candidate.name === projectName)
      if (!project) return false
      return (await validateShare(project.root, token).catch(() => null)) !== null
    },
    shareProviders: {
      list: async (projectName, includeTokens) => {
        const project = config.projects.find((candidate) => candidate.name === projectName)
        if (!project) return []
        return listShares(project.root, { includeTokens })
      },
      add: async (projectName, input) => {
        const project = config.projects.find((candidate) => candidate.name === projectName)
        if (!project) throw new Error('Project is not configured')
        return addShare(project.root, input)
      },
      revoke: async (projectName, id) => {
        const project = config.projects.find((candidate) => candidate.name === projectName)
        if (!project) throw new Error('Project is not configured')
        return revokeShare(project.root, id)
      },
    },
  })
  try {
    await filesystemMonitor.start()
    await listen(server, config.backend.bindAddr, config.backend.bindPort)
  } catch {
    filesystemMonitor.stop()
    eventStream.close()
    terminalService?.close()
    throw new ConfigError(
      `Backend failed to listen on ${config.backend.bindAddr}:${config.backend.bindPort}`,
      configPath,
    )
  }

  const status: BackendServeStatus = {
    action: 'backend-serve',
    outcome: 'listening',
    host: config.backend.hostId,
    bind: { address: config.backend.bindAddr, port: config.backend.bindPort },
    release: runningRelease,
    revision: runningRevision,
    configPath,
    capabilities,
  }
  const writeOutput = dependencies.writeOutput ?? ((text: string) => process.stdout.write(text))
  writeOutput(renderStatus(status, options.format))
  return { server, status }
}
