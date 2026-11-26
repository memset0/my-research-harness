import { describe, expect, it } from 'vitest'
import { listEntry, NodeAccessError, nodeErrorExitCode, parseNodes, selectNode } from './nodes.js'

describe('CLI node adapter', () => {
  it('maps registry error codes to the stable exit codes', () => {
    expect(nodeErrorExitCode(new NodeAccessError('NODES_CONFIG_INVALID', 'x'))).toBe(2)
    expect(nodeErrorExitCode(new NodeAccessError('BAD_REQUEST', 'x'))).toBe(2)
    expect(nodeErrorExitCode(new NodeAccessError('NOT_FOUND', 'x'))).toBe(4)
    expect(nodeErrorExitCode(new NodeAccessError('NODE_EXPIRED', 'x'))).toBe(13)
  })

  it('re-exports the shared registry, including allocation fields', () => {
    const nodes = parseNodes({
      schema_version: 1,
      nodes: {
        n: {
          available_until: '2030-01-01T00:00:00Z',
          via: 'x',
          gpus: 8,
          allocatable_gpus: [5, 6],
        },
      },
    })
    expect(selectNode(nodes, 'n').id).toBe('n')
    expect(listEntry(nodes[0]!)).toMatchObject({ allocation: 'gpus', allocatable_gpus: [5, 6] })
  })
})
