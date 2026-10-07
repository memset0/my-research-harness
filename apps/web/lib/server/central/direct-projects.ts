// Host namespaces and Projects this instance serves directly from its own
// filesystem.
//
// This is the counterpart of CentralHostRegistry: identity and routing state
// for Projects that need no peer Backend. There is nothing to probe — a
// configured root either resolves or the request is rejected — so a directly
// served Host has no `connecting`/`offline` lifecycle, no service token, and no
// event fan-in. Per-request filesystem health is reported through the file
// status headers instead of a Host availability state.

import {
  type BackendCapabilities,
  type BackendProjectSummary,
  type Config,
  formatIsoLocal,
  HostIdSchema,
  MEMON_RELEASE,
  MEMON_REVISION,
  type ProjectConfig,
  ProjectNameSchema,
} from '@memon/core'
import type { DisplayHostAvailability } from './fleet-controller'

export interface DirectHostProjects {
  host: string
  projects: readonly ProjectConfig[]
}

/**
 * Capability advertisement for one directly served Host. Read capabilities are
 * inherent to owning the files; every command capability requires an explicit
 * execution provider (`local` for a genuinely local root, `ssh` for a mounted
 * one), because running a command against a mount would otherwise execute on
 * the wrong machine.
 */
function hostCapabilities(
  projects: readonly ProjectConfig[],
  slurmEnabled: boolean,
): BackendCapabilities {
  const writable = projects.some((project) => project.readOnly !== true)
  const execution = projects.some((project) => project.execution !== undefined)
  return {
    projects: true,
    mutations: writable,
    // Documents and lists are learned by polling the file store; no Backend
    // event stream exists to subscribe to.
    events: false,
    logStreaming: true,
    reportAssets: true,
    wikiAssets: true,
    git: execution,
    // Share administration is a dedicated owner permission over the Project's
    // own share file, not a Project-data write, so read-only data policy does
    // not remove it.
    shares: true,
    slurm: execution && slurmEnabled,
  }
}

export class DirectProjectRegistry {
  private readonly hosts = new Map<string, ProjectConfig[]>()
  private readonly slurmEnabled: boolean
  private readonly observedAt: string

  constructor(config: Config, now: Date = new Date()) {
    this.observedAt = formatIsoLocal(now)
    this.slurmEnabled = config.slurm.totalNodes !== -1
    for (const project of config.projects) {
      if (project.host === undefined) continue
      const host = HostIdSchema.parse(project.host)
      const existing = this.hosts.get(host)
      if (existing) existing.push(project)
      else this.hosts.set(host, [project])
    }
  }

  get empty(): boolean {
    return this.hosts.size === 0
  }

  hasHost(host: unknown): boolean {
    const parsed = HostIdSchema.safeParse(host)
    return parsed.success && this.hosts.has(parsed.data)
  }

  /**
   * Configured Host namespaces presented as availability rows. A directly
   * served Host is online from process start: its files are reachable through
   * the same process that answers the request.
   */
  listAvailability(): DisplayHostAvailability[] {
    return [...this.hosts.entries()].map(
      ([host, projects]) =>
        ({
          host,
          state: 'online',
          diagnostic: null,
          lastSuccessfulCheckAt: this.observedAt,
          centralRelease: MEMON_RELEASE,
          backendRelease: MEMON_RELEASE,
          backendRevision: MEMON_REVISION,
          capabilities: hostCapabilities(projects, this.slurmEnabled),
        }) as DisplayHostAvailability,
    )
  }

  capabilities(host: unknown): BackendCapabilities | null {
    const parsed = HostIdSchema.safeParse(host)
    const projects = parsed.success ? this.hosts.get(parsed.data) : undefined
    return projects ? hostCapabilities(projects, this.slurmEnabled) : null
  }

  /** Host-qualified Project summaries; never exposes roots or mount paths. */
  listProjects(): BackendProjectSummary[] {
    return [...this.hosts.entries()].flatMap(([host, projects]) =>
      projects.map((project) => ({ host, project: project.name }) as BackendProjectSummary),
    )
  }

  listHosts(): DirectHostProjects[] {
    return [...this.hosts.entries()].map(([host, projects]) => ({ host, projects }))
  }

  /** Resolve one exact Host+Project to its configured root, or null. */
  resolve(host: unknown, project: unknown): ProjectConfig | null {
    const parsedHost = HostIdSchema.safeParse(host)
    const parsedProject = ProjectNameSchema.safeParse(project)
    if (!parsedHost.success || !parsedProject.success) return null
    const projects = this.hosts.get(parsedHost.data)
    return projects?.find((candidate) => candidate.name === parsedProject.data) ?? null
  }

  /**
   * Resolve a Project by name for central-owned routes that carry `?project=`
   * and optionally `?host=`. An ambiguous name across two Host namespaces
   * without a `host` selector resolves to nothing rather than guessing.
   */
  resolveByName(
    projectName: unknown,
    host?: unknown,
  ): { host: string; project: ProjectConfig } | null {
    if (host !== undefined && host !== null) {
      const project = this.resolve(host, projectName)
      return project ? { host: HostIdSchema.parse(host), project } : null
    }
    const parsed = ProjectNameSchema.safeParse(projectName)
    if (!parsed.success) return null
    const matches = [...this.hosts.entries()].flatMap(([hostId, projects]) => {
      const project = projects.find((candidate) => candidate.name === parsed.data)
      return project ? [{ host: hostId, project }] : []
    })
    return matches.length === 1 ? matches[0]! : null
  }
}

/** True when this configuration serves at least one Project from its own filesystem. */
export function servesProjectsDirectly(config: Config): boolean {
  return config.projects.length > 0
}
