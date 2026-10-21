// project-file-store/agent-registry — the process-global File Agent
// registrations, kept in a leaf so the runtime can read a root's source
// identity without importing the adapters (which use the store).

import type { FileAdapter } from '@memon/file-protocol'
import type { ProjectFileContext } from '../project-file-context.js'
import type { FileAgentConfig } from '../types.js'

const REGISTRY = Symbol.for('memon.file-agent-adapters.v1')
export interface Registration {
  root: string
  group: string
  identity: string
  client: Promise<FileAdapter> | null
  connection: FileAgentConfig
  credentialDigest?: string
  credentialCheck?: Promise<void>
  contexts?: WeakMap<ProjectFileContext, Promise<void>>
}
export function registrations(): Map<string, Registration> {
  const carrier = globalThis as unknown as { [REGISTRY]?: Map<string, Registration> }
  carrier[REGISTRY] ??= new Map()
  return carrier[REGISTRY]
}

export function agentSourceIdentity(root: string): string | undefined {
  return registrations().get(root)?.identity
}
