import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { parse as parseYaml } from 'yaml'
import { EXIT, type ExitCode } from './exit-codes.js'

export class NodeAccessError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly exitCode: ExitCode,
  ) {
    super(message)
  }
}

const invalid = (message: string) =>
  new NodeAccessError('NODES_CONFIG_INVALID', message, EXIT.USAGE)

export type NodeTransport =
  | { kind: 'ssh'; target: string; options: string[] }
  | { kind: 'via'; via: string; shell?: string }

export interface NodeDefinition {
  id: string
  cluster?: string
  gpus?: number
  gpuType?: string
  availableUntil: string
  availableUntilMs: number
  enter?: string[]
  enterTty?: string[]
  transport: NodeTransport
}

const NODE_ID = /^[a-z0-9][a-z0-9._-]{0,63}$/
// Seconds and fractions are optional; the offset is not.
const OFFSET_DATETIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/
const NODE_KEYS = new Set([
  'cluster',
  'gpus',
  'gpu_type',
  'available_until',
  'ssh',
  'via',
  'shell',
  'enter',
  'enter_tty',
])

export function nodesConfigPath(env: NodeJS.ProcessEnv = process.env): string {
  const override = env.MEMON_NODES_CONFIG
  if (override) return path.resolve(override)
  return path.join(os.homedir(), '.config', 'memon', 'nodes.yml')
}

export async function loadNodes(file = nodesConfigPath()): Promise<NodeDefinition[]> {
  let text: string
  try {
    text = await fs.readFile(file, 'utf8')
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw err
  }
  let raw: unknown
  try {
    raw = parseYaml(text)
  } catch (err) {
    throw invalid(`${file}: ${(err as Error).message}`)
  }
  return parseNodes(raw)
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)

function nonEmptyString(value: unknown, where: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw invalid(`${where} must be a non-empty string`)
  }
  return value
}

function stringArray(value: unknown, where: string): string[] {
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    value.some((item) => typeof item !== 'string' || item === '')
  ) {
    throw invalid(`${where} must be a non-empty list of non-empty strings`)
  }
  return value as string[]
}

export function parseNodes(raw: unknown): NodeDefinition[] {
  if (raw === null || raw === undefined) return []
  if (!isRecord(raw)) throw invalid('the registry must be a mapping')
  for (const key of Object.keys(raw)) {
    if (key !== 'schema_version' && key !== 'nodes') throw invalid(`unknown top-level key "${key}"`)
  }
  if (raw.schema_version !== 1) throw invalid('schema_version must be 1')
  if (raw.nodes === undefined || raw.nodes === null) return []
  if (!isRecord(raw.nodes)) throw invalid('nodes must be a mapping keyed by node id')
  return Object.entries(raw.nodes)
    .map(([id, entry]) => parseNode(id, entry))
    .sort((a, b) => a.id.localeCompare(b.id))
}

function parseNode(id: string, entry: unknown): NodeDefinition {
  const at = `node "${id}"`
  if (!NODE_ID.test(id)) throw invalid(`${at}: id must match ${NODE_ID.source}`)
  if (!isRecord(entry)) throw invalid(`${at} must be a mapping`)
  for (const key of Object.keys(entry)) {
    if (!NODE_KEYS.has(key)) throw invalid(`${at}: unknown key "${key}"`)
  }

  const until = entry.available_until
  if (typeof until !== 'string' || !OFFSET_DATETIME.test(until)) {
    throw invalid(
      `${at}: available_until must be an ISO 8601 date-time with an explicit offset (Z or ±HH:MM)`,
    )
  }
  const untilMs = Date.parse(until)
  if (Number.isNaN(untilMs)) throw invalid(`${at}: available_until is not a valid date-time`)

  const hasSsh = entry.ssh !== undefined
  const hasVia = entry.via !== undefined
  if (hasSsh === hasVia) throw invalid(`${at}: declare exactly one of ssh or via`)

  let transport: NodeTransport
  if (hasSsh) {
    if (entry.shell !== undefined) throw invalid(`${at}: shell is only valid for via nodes`)
    if (!isRecord(entry.ssh)) throw invalid(`${at}: ssh must be a mapping`)
    for (const key of Object.keys(entry.ssh)) {
      if (key !== 'target' && key !== 'options') throw invalid(`${at}: unknown ssh key "${key}"`)
    }
    transport = {
      kind: 'ssh',
      target: nonEmptyString(entry.ssh.target, `${at}: ssh.target`),
      options:
        entry.ssh.options === undefined ? [] : stringArray(entry.ssh.options, `${at}: ssh.options`),
    }
  } else {
    transport = {
      kind: 'via',
      via: nonEmptyString(entry.via, `${at}: via`),
      ...(entry.shell !== undefined ? { shell: nonEmptyString(entry.shell, `${at}: shell`) } : {}),
    }
  }

  const node: NodeDefinition = {
    id,
    availableUntil: until,
    availableUntilMs: untilMs,
    transport,
  }
  if (entry.cluster !== undefined) node.cluster = nonEmptyString(entry.cluster, `${at}: cluster`)
  if (entry.gpu_type !== undefined) node.gpuType = nonEmptyString(entry.gpu_type, `${at}: gpu_type`)
  if (entry.gpus !== undefined) {
    if (!Number.isInteger(entry.gpus) || (entry.gpus as number) < 1) {
      throw invalid(`${at}: gpus must be a positive integer`)
    }
    node.gpus = entry.gpus as number
  }
  if (entry.enter !== undefined) node.enter = stringArray(entry.enter, `${at}: enter`)
  if (entry.enter_tty !== undefined)
    node.enterTty = stringArray(entry.enter_tty, `${at}: enter_tty`)
  return node
}

export function isExpired(node: NodeDefinition, now = Date.now()): boolean {
  return now >= node.availableUntilMs
}

export function isInteractive(node: NodeDefinition): boolean {
  return node.transport.kind === 'ssh' || node.transport.shell !== undefined
}

export function selectNode(nodes: NodeDefinition[], id: string, now = Date.now()): NodeDefinition {
  const node = nodes.find((candidate) => candidate.id === id)
  if (!node)
    throw new NodeAccessError('NOT_FOUND', `node "${id}" is not registered`, EXIT.NOT_FOUND)
  if (isExpired(node, now)) {
    throw new NodeAccessError(
      'NODE_EXPIRED',
      `node "${id}" expired at ${node.availableUntil}`,
      EXIT.FORBIDDEN,
    )
  }
  return node
}

export function shellQuote(word: string): string {
  if (/^[A-Za-z0-9_@%+=:,./-]+$/.test(word)) return word
  return `'${word.replaceAll("'", `'\\''`)}'`
}

const shellJoin = (words: string[]) => words.map(shellQuote).join(' ')

export function remoteLine(node: NodeDefinition, command: string[]): string {
  const line = command.join(' ')
  return node.enter ? `${shellJoin(node.enter)} sh -c ${shellQuote(line)}` : line
}

const SSH_SAFETY = [
  '-o',
  'BatchMode=yes',
  '-o',
  'ForwardAgent=no',
  '-o',
  'StrictHostKeyChecking=yes',
]

export interface Invocation {
  file: string
  args: string[]
}

function sshArgs(transport: Extract<NodeTransport, { kind: 'ssh' }>, ttyFlag: string): string[] {
  return [
    ttyFlag,
    ...SSH_SAFETY,
    ...transport.options.flatMap((option) => ['-o', option]),
    transport.target,
  ]
}

function viaInvocation(via: string, line?: string): Invocation {
  if (line === undefined) return { file: '/bin/sh', args: ['-c', via] }
  return { file: '/bin/sh', args: ['-c', `${via} "$1"`, 'memon-via', line] }
}

export function commandInvocation(node: NodeDefinition, command: string[]): Invocation {
  const line = remoteLine(node, command)
  const { transport } = node
  if (transport.kind === 'ssh') return { file: 'ssh', args: [...sshArgs(transport, '-T'), line] }
  return viaInvocation(transport.via, line)
}

export function interactiveInvocation(node: NodeDefinition): Invocation {
  const { transport } = node
  if (transport.kind === 'via') {
    if (transport.shell === undefined) {
      throw new NodeAccessError(
        'BAD_REQUEST',
        `node "${node.id}" has no interactive shell; use memon ssh ${node.id} -- <command>`,
        EXIT.USAGE,
      )
    }
    return viaInvocation(transport.shell)
  }
  const prefix = node.enterTty ?? node.enter
  const args = sshArgs(transport, '-tt')
  return { file: 'ssh', args: prefix ? [...args, `${shellJoin(prefix)} bash -l`] : args }
}

export function listEntry(node: NodeDefinition, now = Date.now()) {
  return {
    id: node.id,
    cluster: node.cluster ?? null,
    gpus: node.gpus ?? null,
    gpu_type: node.gpuType ?? null,
    available_until: node.availableUntil,
    expired: isExpired(node, now),
    transport: node.transport.kind,
    interactive: isInteractive(node),
  }
}
