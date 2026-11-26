import type { NodeAccessError } from '@memon/core'
import { EXIT, type ExitCode } from './exit-codes.js'

export type { NodeDefinition, NodeInvocation as Invocation } from '@memon/core'
export {
  loadNodes,
  NodeAccessError,
  nodeCommandInvocation as commandInvocation,
  nodeInteractiveInvocation as interactiveInvocation,
  nodeListEntry as listEntry,
  nodeRemoteLine as remoteLine,
  nodesConfigPath,
  parseNodes,
  selectNode,
} from '@memon/core'

const EXIT_BY_CODE: Record<NodeAccessError['code'], ExitCode> = {
  NODES_CONFIG_INVALID: EXIT.USAGE,
  BAD_REQUEST: EXIT.USAGE,
  NOT_FOUND: EXIT.NOT_FOUND,
  NODE_EXPIRED: EXIT.FORBIDDEN,
}

export function nodeErrorExitCode(err: NodeAccessError): ExitCode {
  return EXIT_BY_CODE[err.code]
}
