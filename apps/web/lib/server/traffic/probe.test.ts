// @vitest-environment node
import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import type { Config, ProjectConfig } from '@memon/core'
import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

import {
  AGENT_PROBE_REQUESTS,
  probeFileAgent,
  probeSshDownload,
  probeSshEcho,
  probeSupportOf,
  runProbe,
  SSH_DOWNLOAD_BYTES,
  SSH_ECHO_ROUNDS,
} from './probe'

const agentProject = {
  name: 'project-a',
  host: 'h1',
  root: 'memon-file://h1/project-a',
  include: [],
  exclude: [],
  access: {
    kind: 'agent',
    cache: 'memory',
    connection: 'src',
    project: 'remote-a',
    sourceIdentity: 'id-1',
  },
} as unknown as ProjectConfig
const sshProject = {
  name: 'project-b',
  host: 'h2',
  root: '/mnt/b',
  include: [],
  exclude: [],
  storage: 'sshfs',
  execution: { kind: 'ssh', target: 'user@h2', remoteRoot: '/srv/b', port: 2222 },
} as unknown as ProjectConfig
const mountOnly = { ...sshProject, name: 'project-c', execution: undefined } as ProjectConfig
const nativeProject = {
  name: 'project-d',
  host: 'central',
  root: '/srv/d',
  include: [],
  exclude: [],
} as unknown as ProjectConfig
const config = {
  projects: [agentProject, sshProject, mountOnly, nativeProject],
  fileAgents: {
    src: { endpoint: 'https://127.0.0.1:1', caFile: 'ca', certificateFile: 'c', keyFile: 'k' },
  },
} as unknown as Config

/** A fake `ssh` child: `cat` echoes stdin; `head` emits the requested bytes. */
function fakeSsh(args: string[], options: { refuse?: boolean } = {}) {
  const child = new EventEmitter() as EventEmitter & {
    stdin: PassThrough
    stdout: PassThrough
    stderr: PassThrough
    kill: () => void
  }
  child.stdin = new PassThrough()
  child.stdout = new PassThrough()
  child.stderr = new PassThrough()
  child.kill = () => {}
  const command = args.slice(args.indexOf('--') + 2)
  setTimeout(() => {
    if (options.refuse) {
      child.stderr.write('Permission denied (publickey).')
      child.emit('exit', 255)
      child.emit('close', 255)
      return
    }
    if (command[0] === 'cat') child.stdin.on('data', (chunk) => child.stdout.write(chunk))
    if (command[0] === 'head') {
      child.stdout.write(Buffer.alloc(Number(command[2])))
      setTimeout(() => child.emit('close', 0), 5)
    }
  }, 5)
  return child as never
}

describe('probeSupportOf', () => {
  it('maps each transport to an honest probe kind', () => {
    expect(probeSupportOf(agentProject, config)).toEqual({
      transport: 'file-agent',
      probe: 'agent',
    })
    expect(probeSupportOf(sshProject, config)).toEqual({ transport: 'ssh-tunnel', probe: 'ssh' })
    expect(probeSupportOf(mountOnly, config)).toMatchObject({ probe: 'none' })
    expect(probeSupportOf(nativeProject, config)).toEqual({ transport: 'native', probe: 'native' })
    expect(
      probeSupportOf(agentProject, { ...config, fileAgents: {} } as unknown as Config),
    ).toMatchObject({ probe: 'none', reason: expect.stringContaining('src') })
  })
})

describe('probeFileAgent', () => {
  it('times sequential capability requests over one connection, first one as setup', async () => {
    const seen: string[] = []
    const [step] = await probeFileAgent(agentProject, config, {
      readFile: async () => Buffer.from('pem'),
      requestOnce: async (url, _agent, headers) => {
        seen.push(
          `${url.pathname}?${url.searchParams} ${headers['x-memon-expected-source-identity']}`,
        )
        return 200
      },
    })
    expect(seen).toHaveLength(AGENT_PROBE_REQUESTS)
    expect(seen[0]).toBe('/v1/capabilities?project=remote-a id-1')
    expect(step).toMatchObject({ ok: true, samples: AGENT_PROBE_REQUESTS - 1 })
    expect(step!.setupMs).not.toBeNull()
    expect(step!.medianMs).not.toBeNull()
  })

  it('reports an agent refusal instead of timings', async () => {
    const [step] = await probeFileAgent(agentProject, config, {
      readFile: async () => Buffer.from('pem'),
      requestOnce: async () => 403,
    })
    expect(step).toMatchObject({ ok: false, note: 'Agent answered HTTP 403' })
  })
})

describe('SSH probes', () => {
  it('measures echo round trips with pinned, uncompressed, non-interactive ssh', async () => {
    let args: string[] = []
    const step = await probeSshEcho(sshProject, {
      spawnSsh: (a) => {
        args = a
        return fakeSsh(a)
      },
    })
    expect(args).toEqual(expect.arrayContaining(['BatchMode=yes', 'Compression=no', '-p', '2222']))
    expect(args.slice(-2)).toEqual(['user@h2', 'cat'])
    expect(step).toMatchObject({ ok: true, samples: SSH_ECHO_ROUNDS })
  })

  it('downloads a bounded random payload', async () => {
    const step = await probeSshDownload(sshProject, { spawnSsh: (a) => fakeSsh(a) })
    expect(step).toMatchObject({ ok: true, bytes: SSH_DOWNLOAD_BYTES })
    expect(step.throughputBps).toBeGreaterThan(0)
  })

  it('surfaces an ssh failure', async () => {
    const step = await probeSshEcho(sshProject, {
      spawnSsh: (a) => fakeSsh(a, { refuse: true }),
    })
    expect(step).toMatchObject({ ok: false, note: 'Permission denied (publickey).' })
  })
})

describe('runProbe', () => {
  it('says why a transport cannot be probed and sends nothing', async () => {
    const spawnSsh = vi.fn()
    const result = await runProbe(config, { host: 'h2', project: 'project-c' }, { spawnSsh })
    expect(result.steps).toEqual([
      expect.objectContaining({ ok: false, note: expect.stringContaining('Not probeable') }),
    ])
    expect(spawnSsh).not.toHaveBeenCalled()
  })

  it('reports native as having no network leg and adds the service fetch', async () => {
    const serviceFetch = vi.fn(async () => ({ label: 'Service fetch', ok: true, bytes: 10 }))
    const result = await runProbe(
      config,
      {
        host: 'central',
        project: 'project-d',
        document: { kind: 'report', id: 'R0001' },
        path: '/x',
      },
      { serviceFetch },
    )
    expect(result.transport).toBe('native')
    expect(result.steps[0]!.note).toContain('no network leg')
    expect(serviceFetch).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'report', id: 'R0001', path: '/x' }),
    )
    expect(result.steps).toHaveLength(2)
  })
})
