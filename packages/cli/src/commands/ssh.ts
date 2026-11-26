import { spawn } from 'node:child_process'
import os from 'node:os'
import { emitErrorAndExit } from '../lib/emit-error.js'
import { EXIT } from '../lib/exit-codes.js'
import {
  commandInvocation,
  type Invocation,
  interactiveInvocation,
  listEntry,
  loadNodes,
  NodeAccessError,
  nodeErrorExitCode,
  nodesConfigPath,
  selectNode,
} from '../lib/nodes.js'

export interface SshOptions {
  node?: string
  command: string[]
  list: boolean
  isTty: boolean
}

function fail(err: unknown): never {
  if (err instanceof NodeAccessError)
    emitErrorAndExit(err.code, err.message, undefined, nodeErrorExitCode(err))
  throw err
}

function run(invocation: Invocation): Promise<number> {
  return new Promise((resolve) => {
    const child = spawn(invocation.file, invocation.args, { stdio: 'inherit' })
    child.on('error', (err) => {
      emitErrorAndExit(
        'TRANSPORT_UNAVAILABLE',
        `cannot start ${invocation.file}: ${err.message}`,
        undefined,
        EXIT.GENERIC,
      )
    })
    child.on('exit', (code, signal) => {
      resolve(code ?? 128 + (signal ? (os.constants.signals[signal] ?? 0) : 0))
    })
  })
}

/** Returns the exit status to propagate. */
export async function runSsh(opts: SshOptions): Promise<number> {
  const nodes = await loadNodes(nodesConfigPath()).catch(fail)
  if (opts.list) {
    process.stdout.write(`${JSON.stringify({ nodes: nodes.map((node) => listEntry(node)) })}\n`)
    return EXIT.SUCCESS
  }
  if (opts.node === undefined) {
    emitErrorAndExit('BAD_REQUEST', 'name a node, or use --list')
  }
  let invocation: Invocation
  try {
    const node = selectNode(nodes, opts.node)
    if (opts.command.length > 0) {
      invocation = commandInvocation(node, opts.command)
    } else {
      if (!opts.isTty) {
        emitErrorAndExit(
          'BAD_REQUEST',
          `no terminal for an interactive session; use memon ssh ${node.id} -- <command>`,
        )
      }
      invocation = interactiveInvocation(node)
    }
  } catch (err) {
    fail(err)
  }
  return run(invocation)
}
