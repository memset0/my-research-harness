import { describe, expect, it } from 'vitest'
import {
  commandInvocation,
  interactiveInvocation,
  listEntry,
  NodeAccessError,
  nodesConfigPath,
  parseNodes,
  remoteLine,
  selectNode,
} from './nodes.js'

const until = '2030-01-01T00:00:00+08:00'

function registry(nodes: Record<string, unknown>) {
  return { schema_version: 1, nodes }
}

function rejects(raw: unknown, pattern: RegExp) {
  try {
    parseNodes(raw)
  } catch (err) {
    expect(err).toBeInstanceOf(NodeAccessError)
    expect((err as NodeAccessError).code).toBe('NODES_CONFIG_INVALID')
    expect((err as NodeAccessError).exitCode).toBe(2)
    expect((err as Error).message).toMatch(pattern)
    return
  }
  throw new Error('expected parseNodes to reject')
}

describe('registry validation', () => {
  it('honours MEMON_NODES_CONFIG', () => {
    expect(nodesConfigPath({ MEMON_NODES_CONFIG: '/tmp/n.yml' })).toBe('/tmp/n.yml')
    expect(nodesConfigPath({})).toMatch(/\.config\/memon\/nodes\.yml$/)
  })

  it('treats an empty document as an empty registry', () => {
    expect(parseNodes(null)).toEqual([])
    expect(parseNodes({ schema_version: 1 })).toEqual([])
  })

  it('requires schema_version 1 and rejects unknown top-level keys', () => {
    rejects({ nodes: {} }, /schema_version/)
    rejects({ schema_version: 1, hosts: {} }, /unknown top-level key "hosts"/)
  })

  it('requires exactly one transport', () => {
    rejects(
      registry({ 'node-01': { available_until: until, via: 'sh -c', ssh: { target: 'h' } } }),
      /node "node-01": declare exactly one of ssh or via/,
    )
    rejects(registry({ 'node-01': { available_until: until } }), /exactly one of ssh or via/)
  })

  it('rejects unknown keys and bad ids', () => {
    rejects(
      registry({ 'node-01': { available_until: until, via: 'sh -c', hostname: 'x' } }),
      /unknown key "hostname"/,
    )
    rejects(registry({ Node: { available_until: until, via: 'sh -c' } }), /id must match/)
    rejects(
      registry({ n: { available_until: until, ssh: { target: 'h', port: 22 } } }),
      /unknown ssh key "port"/,
    )
  })

  it('requires an explicit offset on available_until', () => {
    for (const value of ['2026-12-20T09:00:00', '2026-12-20', 1_700_000_000]) {
      rejects(registry({ n: { available_until: value, via: 'sh -c' } }), /explicit offset/)
    }
    expect(
      parseNodes(registry({ n: { available_until: '2026-12-20T09:00Z', via: 'x' } })),
    ).toHaveLength(1)
  })

  it('validates optional fields', () => {
    rejects(registry({ n: { available_until: until, via: 'x', gpus: 0 } }), /gpus/)
    rejects(registry({ n: { available_until: until, via: 'x', enter: [] } }), /enter/)
    rejects(registry({ n: { available_until: until, ssh: { target: 'h' }, shell: 'x' } }), /shell/)
  })
})

describe('availability', () => {
  const [node] = parseNodes(
    registry({ n: { available_until: '2026-12-19T16:00:00-08:00', via: 'x' } }),
  )

  it('compares offsets as absolute time', () => {
    expect(selectNode([node!], 'n', Date.parse('2026-12-19T23:30:00Z')).id).toBe('n')
  })

  it('refuses expired and unknown nodes', () => {
    expect(() => selectNode([node!], 'n', Date.parse('2026-12-20T00:00:00Z'))).toThrow(
      expect.objectContaining({ code: 'NODE_EXPIRED', exitCode: 13 }),
    )
    expect(() => selectNode([node!], 'missing')).toThrow(
      expect.objectContaining({ code: 'NOT_FOUND', exitCode: 4 }),
    )
  })
})

describe('invocations', () => {
  const nodes = parseNodes(
    registry({
      slurm: {
        available_until: until,
        ssh: { target: 'user@login.example', options: ['UserKnownHostsFile=/k'] },
        enter: ['srun', '--jobid=42', '--overlap'],
        enter_tty: ['srun', '--jobid=42', '--overlap', '--pty'],
      },
      plain: { available_until: until, ssh: { target: 'host-a' } },
      relay: { available_until: until, via: 'relay-client connect', cluster: 'cluster-b', gpus: 2 },
      relayshell: {
        available_until: until,
        via: 'relay-client connect',
        shell: 'relay-client shell',
      },
    }),
  )
  const byId = (id: string) => nodes.find((node) => node.id === id)!

  it('wraps the whole line inside enter', () => {
    expect(remoteLine(byId('slurm'), ['cd /tmp && hostname'])).toBe(
      "srun --jobid=42 --overlap sh -c 'cd /tmp && hostname'",
    )
    expect(remoteLine(byId('plain'), ['echo', "it's"])).toBe("echo it's")
  })

  it('builds a batch ssh command', () => {
    expect(commandInvocation(byId('slurm'), ['hostname'])).toEqual({
      file: 'ssh',
      args: [
        '-T',
        '-o',
        'BatchMode=yes',
        '-o',
        'ForwardAgent=no',
        '-o',
        'StrictHostKeyChecking=yes',
        '-o',
        'UserKnownHostsFile=/k',
        'user@login.example',
        'srun --jobid=42 --overlap sh -c hostname',
      ],
    })
  })

  it('passes the line to via as one argument', () => {
    expect(commandInvocation(byId('relay'), ['a  b'])).toEqual({
      file: '/bin/sh',
      args: ['-c', 'relay-client connect "$1"', 'memon-via', 'a  b'],
    })
  })

  it('opens interactive sessions only where possible', () => {
    expect(interactiveInvocation(byId('slurm')).args.slice(0, 1)).toEqual(['-tt'])
    expect(interactiveInvocation(byId('slurm')).args.at(-1)).toBe(
      'srun --jobid=42 --overlap --pty bash -l',
    )
    expect(interactiveInvocation(byId('plain')).args.at(-1)).toBe('host-a')
    expect(interactiveInvocation(byId('relayshell'))).toEqual({
      file: '/bin/sh',
      args: ['-c', 'relay-client shell'],
    })
    expect(() => interactiveInvocation(byId('relay'))).toThrow(
      expect.objectContaining({ code: 'BAD_REQUEST', exitCode: 2 }),
    )
  })

  it('lists nodes without connection details', () => {
    const listed = JSON.stringify(nodes.map((node) => listEntry(node)))
    expect(listed).not.toMatch(/login\.example|relay-client|srun|UserKnownHostsFile/)
    expect(listEntry(byId('relay'))).toEqual({
      id: 'relay',
      cluster: 'cluster-b',
      gpus: 2,
      gpu_type: null,
      available_until: until,
      expired: false,
      transport: 'via',
      interactive: false,
    })
  })
})
