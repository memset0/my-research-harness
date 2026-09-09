import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import {
  type BackendCapabilities,
  type BackendEventFrame,
  BackendEventFrameSchema,
  HostQualifiedBackendEventSchema,
  type ProjectConfig,
} from '@memon/core'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BackendEventStream } from './event-stream.js'
import {
  BackendFilesystemMonitor,
  type BackendMonitorSnapshot,
  type BackendMonitorTimer,
} from './filesystem-monitor.js'
import { createBackendServer } from './server.js'

const EPOCH = '123e4567-e89b-42d3-a456-426614174000'
const CAPABILITIES = {
  projects: true,
  mutations: true,
  events: true,
  logStreaming: true,
  reportAssets: true,
  wikiAssets: true,
  git: true,
  shares: true,
  slurm: false,
} satisfies BackendCapabilities

interface FakeTimerHandle {
  callback: () => void
  delayMs: number
  active: boolean
}

class FakeTimer implements BackendMonitorTimer {
  readonly handles: FakeTimerHandle[] = []

  setTimeout(callback: () => void, delayMs: number): FakeTimerHandle {
    const handle = { callback, delayMs, active: true }
    this.handles.push(handle)
    return handle
  }

  clearTimeout(handle: unknown): void {
    ;(handle as FakeTimerHandle).active = false
  }

  activeCount(): number {
    return this.handles.filter((handle) => handle.active).length
  }
}

let temp = ''

beforeEach(async () => {
  temp = await fs.mkdtemp(join(tmpdir(), 'memon-backend-monitor-'))
})

afterEach(async () => {
  await fs.rm(temp, { recursive: true, force: true })
})

function snapshot(
  entries: Array<{
    kind: 'run' | 'experiment' | 'report' | 'code-review'
    id: string
    signature: string
  }>,
): BackendMonitorSnapshot {
  return new Map(entries.map((entry) => [`${entry.kind}\0${entry.id}`, entry]))
}

function eventFrames(serialized: readonly string[]): BackendEventFrame[] {
  return serialized.flatMap((frame) => {
    const data = frame.split('\n').find((line) => line.startsWith('data: '))
    return data ? [BackendEventFrameSchema.parse(JSON.parse(data.slice(6)))] : []
  })
}

describe('BackendFilesystemMonitor', () => {
  it('refreshes the shared Project snapshot before publishing change events', async () => {
    const project = {
      name: 'project-a',
      root: join(temp, 'project-a'),
      include: [],
      exclude: [],
    } satisfies ProjectConfig
    let current = snapshot([{ kind: 'run', id: 'run-a', signature: '1' }])
    const order: string[] = []
    const eventStream = new BackendEventStream({ instanceEpoch: EPOCH })
    const unsubscribe = eventStream.subscribe(() => {
      order.push('event')
      return true
    })
    const refreshProject = vi.fn(async () => {
      order.push('refresh')
    })
    const monitor = new BackendFilesystemMonitor({
      projects: [project],
      eventStream,
      scanner: async () => current,
      refreshProject,
      timer: new FakeTimer(),
      minIntervalMs: 10,
      maxIntervalMs: 80,
    })

    await monitor.start()
    expect(refreshProject).toHaveBeenCalledWith('project-a')
    order.length = 0
    current = snapshot([{ kind: 'run', id: 'run-a', signature: '2' }])
    await monitor.pollNow('project-a')
    expect(order[0]).toBe('refresh')
    expect(order).toContain('event')
    monitor.stop()
    unsubscribe()
  })

  it('uses a silent initial snapshot then publishes external set/delete changes for every family', async () => {
    const root = join(temp, 'project-a')
    await fs.cp(resolve(process.cwd(), '../../mock/project-a'), root, { recursive: true })
    const project = { name: 'project-a', root, include: [], exclude: [] } satisfies ProjectConfig
    const eventStream = new BackendEventStream({ instanceEpoch: EPOCH })
    const serialized: string[] = []
    const unsubscribe = eventStream.subscribe((frame) => {
      serialized.push(frame)
      return true
    })
    const monitor = new BackendFilesystemMonitor({
      projects: [project],
      eventStream,
      minIntervalMs: 10,
      maxIntervalMs: 80,
      timer: new FakeTimer(),
    })
    await monitor.start()
    expect(eventStream.currentSequence).toBe(0)

    const runReadme = join(root, 'logs', 'foo-260501-100000', 'README.md')
    const experimentReadme = join(
      root,
      'docs',
      'experiments',
      'E0001-vpred-convergence',
      'README.md',
    )
    const report = join(root, 'docs', 'reports', 'R0001-zero-snr-brightness.md')
    const digest = join(root, 'docs', 'digests', 'D0001-2026-05-01.md')
    const review = join(root, 'docs', 'code-review', '2026-05-24-fsdp-comm-overlap.md')
    const wikiPage = join(root, 'docs', 'wiki', 'finding', 'W0001-zero-snr-brightness.md')
    for (const path of [runReadme, experimentReadme, report, digest, review, wikiPage]) {
      await fs.appendFile(path, '\nexternal monitor edit\n')
      const future = new Date(Date.now() + 2000)
      await fs.utimes(path, future, future)
    }
    await monitor.pollNow('project-a')
    const topics = eventFrames(serialized)
      .filter((frame) => frame.kind === 'event')
      .map((frame) => frame.topic)
    expect(topics).toEqual(
      expect.arrayContaining([
        'run-change',
        'experiment-change',
        'reports-change',
        'code-reviews-change',
        'wiki-change',
        'anomaly',
      ]),
    )
    expect(topics).not.toContain('digests-change')

    await fs.unlink(report)
    await monitor.pollNow('project-a')
    const reportDelete = eventFrames(serialized).find(
      (frame) =>
        frame.kind === 'event' && frame.topic === 'reports-change' && frame.data.type === 'delete',
    )
    expect(reportDelete).toMatchObject({ project: 'project-a', data: { id: 'R0001' } })

    await fs.writeFile(join(root, 'docs', 'reports', 'R0999-external.md'), '# External\n')
    await monitor.pollNow('project-a')
    expect(
      eventFrames(serialized).some(
        (frame) =>
          frame.kind === 'event' &&
          frame.topic === 'reports-change' &&
          frame.data.type === 'set' &&
          frame.data.id === 'R0999',
      ),
    ).toBe(true)
    monitor.stop()
    unsubscribe()
  }, 30_000)

  it('isolates Project failures, preserves snapshots, and applies independent backoff', async () => {
    const projects = [
      { name: 'project-a', root: join(temp, 'a'), include: [], exclude: [] },
      { name: 'project-b', root: join(temp, 'b'), include: [], exclude: [] },
    ] satisfies ProjectConfig[]
    let stateA = snapshot([{ kind: 'run', id: 'run-a', signature: '1' }])
    let stateB = snapshot([{ kind: 'run', id: 'run-b', signature: '1' }])
    let failA = false
    const scanner = vi.fn(async (project: ProjectConfig) => {
      if (project.name === 'project-a' && failA) throw new Error('private cluster failure')
      return project.name === 'project-a' ? stateA : stateB
    })
    const eventStream = new BackendEventStream({ instanceEpoch: EPOCH })
    const monitor = new BackendFilesystemMonitor({
      projects,
      eventStream,
      scanner,
      timer: new FakeTimer(),
      minIntervalMs: 10,
      maxIntervalMs: 80,
      backoffFactor: 2,
    })
    await monitor.start()
    failA = true
    stateB = snapshot([{ kind: 'run', id: 'run-b', signature: '2' }])
    await Promise.all([monitor.pollNow('project-a'), monitor.pollNow('project-b')])
    expect(eventStream.currentSequence).toBe(2)
    expect(monitor.intervalFor('project-a')).toBe(20)
    expect(monitor.intervalFor('project-b')).toBe(10)

    failA = false
    stateA = snapshot([{ kind: 'run', id: 'run-a', signature: '2' }])
    await monitor.pollNow('project-a')
    expect(eventStream.currentSequence).toBe(4)
    expect(monitor.intervalFor('project-a')).toBe(10)
    await monitor.pollNow('project-a')
    expect(monitor.intervalFor('project-a')).toBe(20)
    monitor.stop()
  })

  it('stops all timers and suppresses an in-flight result after shutdown', async () => {
    const project = {
      name: 'project-a',
      root: join(temp, 'project-a'),
      include: [],
      exclude: [],
    } satisfies ProjectConfig
    let resolveScan!: (value: BackendMonitorSnapshot) => void
    let pending = false
    const scanner = vi.fn(async () => {
      if (!pending) return snapshot([{ kind: 'run', id: 'run-a', signature: '1' }])
      return new Promise<BackendMonitorSnapshot>((resolvePending) => {
        resolveScan = resolvePending
      })
    })
    const timer = new FakeTimer()
    const eventStream = new BackendEventStream({ instanceEpoch: EPOCH })
    const monitor = new BackendFilesystemMonitor({
      projects: [project],
      eventStream,
      scanner,
      timer,
      minIntervalMs: 10,
      maxIntervalMs: 80,
    })
    await monitor.start()
    expect(monitor.activeTimerCount()).toBe(1)
    pending = true
    const polling = monitor.pollNow('project-a')
    monitor.stop()
    expect(monitor.activeTimerCount()).toBe(0)
    expect(timer.activeCount()).toBe(0)
    resolveScan(snapshot([{ kind: 'run', id: 'run-a', signature: '2' }]))
    await polling
    expect(eventStream.currentSequence).toBe(0)
  })

  it('produces a central-valid Host-qualified event and server close stops the worker', async () => {
    const project = {
      name: 'project-a',
      root: join(temp, 'project-a'),
      include: [],
      exclude: [],
    } satisfies ProjectConfig
    let current = snapshot([{ kind: 'report', id: 'R0001', signature: '1' }])
    const eventStream = new BackendEventStream({ instanceEpoch: EPOCH })
    const serialized: string[] = []
    const unsubscribe = eventStream.subscribe((frame) => {
      serialized.push(frame)
      return true
    })
    const monitor = new BackendFilesystemMonitor({
      projects: [project],
      eventStream,
      scanner: async () => current,
      timer: new FakeTimer(),
      minIntervalMs: 10,
      maxIntervalMs: 80,
    })
    await monitor.start()
    current = snapshot([{ kind: 'report', id: 'R0001', signature: '2' }])
    await monitor.pollNow('project-a')
    const backendEvent = eventFrames(serialized).find((frame) => frame.kind === 'event')!
    expect(
      HostQualifiedBackendEventSchema.parse({ ...backendEvent, host: 'host-a' }),
    ).toMatchObject({
      host: 'host-a',
      project: 'project-a',
      topic: 'reports-change',
    })

    const stop = vi.spyOn(monitor, 'stop')
    const server = createBackendServer({
      hostId: 'host-a',
      serviceTokens: { current: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' },
      capabilities: CAPABILITIES,
      revision: 'revision-a',
      instanceEpoch: EPOCH,
      eventStream,
      filesystemMonitor: monitor,
    })
    await new Promise<void>((resolveListen) => server.listen(0, '127.0.0.1', resolveListen))
    await new Promise<void>((resolveClose) => server.close(() => resolveClose()))
    expect(stop).toHaveBeenCalledOnce()
    expect(eventStream.subscriberCount).toBe(0)
    unsubscribe()
  })
})
