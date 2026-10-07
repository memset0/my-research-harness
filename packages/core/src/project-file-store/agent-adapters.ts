import { createHash, createPrivateKey, X509Certificate } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { FileAccessError, type FileAdapter, isFileAccessError } from '@memon/file-protocol'
import { FileAgentClient } from '@memon/file-protocol/client'
import { isFileURI, parseFileURI } from '@memon/file-protocol/paths'
import { projectSourceGroup } from '../config/source-group.js'
import { getProjectFileContext, type ProjectFileContext } from '../project-file-context.js'
import type { FileAgentConfig, ProjectConfig } from '../types.js'
import type { FileOperationName } from './contract.js'
import { getProjectFileAccessOptions, getStore } from './runtime.js'
import { budgetedSourceOperation, sourceBudgets } from './source-budget-runtime.js'

const REGISTRY = Symbol.for('memon.file-agent-adapters.v1')
interface Registration {
  root: string
  group: string
  identity: string
  client: Promise<FileAdapter> | null
  connection: FileAgentConfig
  credentialDigest?: string
  credentialCheck?: Promise<void>
  contexts?: WeakMap<ProjectFileContext, Promise<void>>
}
function registrations(): Map<string, Registration> {
  const carrier = globalThis as unknown as { [REGISTRY]?: Map<string, Registration> }
  carrier[REGISTRY] ??= new Map()
  return carrier[REGISTRY]
}

/** Operator-only connection state; credentials are never included in project DTOs. */
export function configureFileAgentAdapters(
  connections: Record<string, FileAgentConfig>,
  projects: readonly ProjectConfig[],
): void {
  const registry = registrations()
  registry.clear()
  for (const project of projects) {
    if (project.access?.kind !== 'agent') continue
    const connection = connections[project.access.connection]
    if (!connection) throw new FileAccessError('BAD_REQUEST')
    registry.set(project.root, {
      root: project.root,
      group: projectSourceGroup(project),
      identity: project.access.sourceIdentity,
      connection,
      client: null,
    })
  }
}

export async function agentAdapter(
  path: string,
): Promise<{ adapter: FileAdapter; target: { project: string; path: string } }> {
  const parsed = parseFileURI(path)
  const registration = registrations().get(parsed.root)
  if (!registration) throw new FileAccessError('SOURCE_UNAVAILABLE')
  const context = getProjectFileContext()
  registration.contexts ??= new WeakMap()
  let check = context ? registration.contexts.get(context) : undefined
  if (!check) {
    registration.credentialCheck ??= refreshCredentials(registration).finally(() => {
      registration.credentialCheck = undefined
    })
    check = registration.credentialCheck
    if (context) registration.contexts.set(context, check)
  }
  await check
  const client = registration.client
  if (!client) throw new FileAccessError('SOURCE_UNAVAILABLE')
  try {
    return { adapter: await client, target: { project: parsed.project, path: parsed.path } }
  } catch (error) {
    if (registration.client === client) registration.client = null
    throw new FileAccessError('SOURCE_UNAVAILABLE', { cause: error })
  }
}

async function refreshCredentials(registration: Registration): Promise<void> {
  let bytes: Buffer[]
  try {
    bytes = await Promise.all([
      readFile(registration.connection.caFile),
      readFile(registration.connection.certificateFile),
      readFile(registration.connection.keyFile),
    ])
  } catch (cause) {
    throw new FileAccessError('SOURCE_UNAVAILABLE', { cause })
  }
  const [ca, certificate, key] = bytes as [Buffer, Buffer, Buffer]
  const digest = createHash('sha256')
    .update(registration.connection.endpoint)
    .update(ca)
    .update(certificate)
    .update(key)
    .digest('hex')
  if (registration.client && registration.credentialDigest === digest) return
  try {
    const identity = new X509Certificate(certificate)
    if (!identity.checkPrivateKey(createPrivateKey(key))) throw new Error('credential key mismatch')
  } catch (cause) {
    throw new FileAccessError('SOURCE_UNAVAILABLE', { cause })
  }
  const client = new FileAgentClient({
    endpoint: registration.connection.endpoint,
    expectedSourceIdentity: registration.identity,
    ca,
    certificate,
    key,
    onResponse: (operation, size, conditional) =>
      getStore().recordTransport(registration.group, operation, size, conditional),
    concurrency: () => getProjectFileAccessOptions().concurrency,
    maxResponseBytes: Math.ceil(getProjectFileAccessOptions().maxReadBytes * 1.5) + 65536,
  })
  const adapter = budgetedAdapter(registration, client)
  // A replacement credential must be authorized at the source before any cached projection is eligible.
  await budgetedSourceOperation(
    registration.group,
    registration.root,
    0,
    () => client.negotiate(parseFileURI(registration.root).project),
    undefined,
    sourceBudgets(),
    'stat',
  )
  registration.credentialDigest = digest
  registration.client = Promise.resolve(adapter)
  getStore().noteAuthority(registration.root, client.authorityIdentity!)
}

export function isAgentPath(path: string): boolean {
  return isFileURI(path)
}
export function missingAgentPath(path: string): NodeJS.ErrnoException {
  return Object.assign(new Error('File does not exist'), { code: 'ENOENT', path })
}

function budgetedAdapter(registration: Registration, client: FileAdapter): FileAdapter {
  const run = async <T>(
    bytes: number,
    work: () => Promise<T>,
    actual?: (value: T) => number,
    operation: FileOperationName = 'readFile',
  ): Promise<T> => {
    try {
      return await budgetedSourceOperation(
        registration.group,
        registration.root,
        bytes,
        work,
        actual,
        sourceBudgets(),
        operation,
        (value) => {
          if (!value || typeof value !== 'object' || Reflect.get(value, 'outcome') !== 'present')
            return 0
          const content = Reflect.get(value, 'content'),
            entries = Reflect.get(value, 'entries')
          return typeof content === 'string'
            ? Buffer.from(content, 'base64').length
            : Array.isArray(entries)
              ? Buffer.byteLength(JSON.stringify(entries))
              : 0
        },
      )
    } catch (error) {
      if (
        isFileAccessError(error) &&
        ['SOURCE_UNAVAILABLE', 'UNAUTHORIZED', 'FORBIDDEN'].includes(error.code)
      )
        registration.client = null
      throw error
    }
  }
  return {
    sourceIdentity: client.sourceIdentity,
    authorityIdentity: client.authorityIdentity,
    read: (target, options) =>
      run(
        getProjectFileAccessOptions().maxReadBytes,
        () => client.read(target, options),
        (value) =>
          value.outcome === 'present'
            ? Buffer.from(value.content, 'base64').length
            : value.outcome === 'unchanged'
              ? getProjectFileAccessOptions().maxReadBytes
              : 0,
      ),
    list: (target, options) =>
      run(
        getProjectFileAccessOptions().maxReadBytes,
        () => client.list(target, options),
        (value) =>
          value.outcome === 'present'
            ? Buffer.byteLength(JSON.stringify(value.entries))
            : value.outcome === 'unchanged'
              ? getProjectFileAccessOptions().maxReadBytes
              : 0,
        'readdir',
      ),
    stat: (target, follow) =>
      run(0, () => client.stat(target, follow), undefined, follow === false ? 'lstat' : 'stat'),
    resolve: (target) => run(0, () => client.resolve(target), undefined, 'realpath'),
    readRange: (input) =>
      run(
        input.length,
        () => client.readRange(input),
        (value) => (value.outcome === 'missing' ? 0 : Buffer.from(value.content, 'base64').length),
      ),
    openRead: (target) =>
      run(
        0,
        () => {
          if (!client.openRead) throw new FileAccessError('CAPABILITY_UNAVAILABLE')
          return client.openRead(target)
        },
        undefined,
        'stat',
      ),
    readAt: (input) =>
      run(
        input.length,
        () => {
          if (!client.readAt) throw new FileAccessError('CAPABILITY_UNAVAILABLE')
          return client.readAt(input)
        },
        (value) => Buffer.from(value.content, 'base64').length,
      ),
    closeRead: (target) =>
      run(
        0,
        () => {
          if (!client.closeRead) throw new FileAccessError('CAPABILITY_UNAVAILABLE')
          return client.closeRead(target)
        },
        undefined,
        'stat',
      ),
    mutate: (input) =>
      run(
        (input.operation === 'rename' && input.fileChecks?.length) ||
          (input.operation !== 'mkdir' && input.precondition.kind === 'match')
          ? getProjectFileAccessOptions().maxReadBytes
          : input.operation === 'replace'
            ? Buffer.from(input.content, 'base64').length
            : 0,
        () => client.mutate(input),
        () =>
          (input.operation === 'rename' && input.fileChecks?.length) ||
          (input.operation !== 'mkdir' && input.precondition.kind === 'match')
            ? getProjectFileAccessOptions().maxReadBytes
            : input.operation === 'replace'
              ? Buffer.from(input.content, 'base64').length
              : 0,
        'write',
      ),
  }
}

export function agentSourceIdentity(root: string): string | undefined {
  return registrations().get(root)?.identity
}

/** Run before a central domain cache can answer without touching project files. */
export async function prepareProjectFileAccess(): Promise<void> {
  const context = getProjectFileContext()
  if (context && isFileURI(context.root)) await agentAdapter(context.root)
}
