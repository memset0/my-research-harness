import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { contentVersion } from '@memon/file-protocol'
import { createTempProject, removeTempDirs } from '@memon/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { readProjectFile } from './conditional.js'
import { getStore, invalidateProjectFile } from './runtime.js'
import { subscribeProjectDirectory, subscribeProjectFile } from './subscriptions.js'

const cancellations: (() => void)[] = []
afterEach(async () => {
  for (const cancel of cancellations.splice(0)) cancel()
  vi.useRealTimers()
  await removeTempDirs()
})
describe('central conditional observations and logical interests', () => {
  it('compares each caller version while preserving the cached observation time', async () => {
    const project = await createTempProject({ files: { 'note.txt': 'first' } })
    const path = join(project.root, 'note.txt')
    const context = { root: project.root, cachePolicy: 'memory' as const, reason: 'open' as const }
    const first = await readProjectFile(context, path)
    await writeFile(path, 'other')
    const cached = await readProjectFile(context, path, {
      knownVersion: contentVersion(Buffer.from('first')),
      policy: 'cached',
    })
    expect(cached).toEqual({
      outcome: 'unchanged',
      version: contentVersion(Buffer.from('first')),
      checkedAt: first.checkedAt,
    })
    const updated = await readProjectFile(context, path, {
      knownVersion: cached.outcome === 'unchanged' ? cached.version : undefined,
      policy: 'revalidate',
    })
    expect(updated.outcome).toBe('present')
    if (updated.outcome === 'present')
      expect(Buffer.from(updated.content, 'base64').toString()).toBe('other')
    invalidateProjectFile(project.root)
  })
  it('fetches a body after eviction instead of relying on the retained version alone', async () => {
    const project = await createTempProject({ files: { 'note.txt': 'first' } })
    const path = join(project.root, 'note.txt')
    const context = { root: project.root, cachePolicy: 'memory' as const, reason: 'open' as const }
    const first = await readProjectFile(context, path)
    if (first.outcome !== 'present') throw new Error('missing fixture')
    getStore().discardTransientBody(project.root, path, 'readFile')
    await writeFile(path, 'other')
    const next = await readProjectFile(context, path, {
      knownVersion: first.version,
      policy: 'cached',
    })
    expect(next.outcome).toBe('present')
    if (next.outcome === 'present')
      expect(Buffer.from(next.content, 'base64').toString()).toBe('other')
    invalidateProjectFile(project.root)
  })
  it('shares one polling channel and cancelling one interest leaves the other active', async () => {
    const project = await createTempProject({ files: { 'note.txt': 'first' } })
    vi.useFakeTimers()
    const path = join(project.root, 'note.txt')
    const context = { root: project.root, cachePolicy: 'none' as const, storage: 'local' as const }
    const first = vi.fn()
    const second = vi.fn()
    const a = subscribeProjectFile(context, path, first)
    const b = subscribeProjectFile(context, path, second)
    cancellations.push(a.cancel, b.cancel)
    await vi.advanceTimersByTimeAsync(0)
    await vi.waitFor(() => expect(first).toHaveBeenCalledTimes(1))
    expect(second).toHaveBeenCalledTimes(1)
    a.cancel()
    await writeFile(path, 'other')
    await vi.advanceTimersByTimeAsync(1200)
    await vi.waitFor(() => expect(second).toHaveBeenCalledTimes(2))
    expect(first).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(2200)
    expect(second).toHaveBeenCalledTimes(2)
  })
  it('expires one leased interest while a renewed subscriber keeps checking without retained native bodies', async () => {
    const project = await createTempProject({ files: { 'note.txt': 'first' } })
    vi.useFakeTimers()
    const context = { root: project.root, cachePolicy: 'none' as const, storage: 'local' as const }
    const path = join(project.root, 'note.txt')
    const expired = vi.fn(),
      active = vi.fn()
    const first = subscribeProjectFile(context, path, expired, { leaseMs: 1500 })
    const second = subscribeProjectFile(context, path, active, { leaseMs: 1500 })
    cancellations.push(first.cancel, second.cancel)
    await vi.advanceTimersByTimeAsync(0)
    await vi.waitFor(() => expect(active).toHaveBeenCalledTimes(1))
    expect(getStore().metricsSnapshot().cachedContentBytes).toBe(0)
    await vi.advanceTimersByTimeAsync(1100)
    second.renew()
    await writeFile(path, 'other')
    await vi.advanceTimersByTimeAsync(1400)
    second.renew()
    await vi.advanceTimersByTimeAsync(1000)
    await vi.waitFor(() => expect(active).toHaveBeenCalledTimes(2))
    expect(expired).toHaveBeenCalledTimes(1)
    expect(getStore().metricsSnapshot().cachedContentBytes).toBe(0)
    second.cancel()
    await writeFile(path, 'third')
    await vi.advanceTimersByTimeAsync(6000)
    expect(active).toHaveBeenCalledTimes(2)
  })
  it('does not turn an I/O failure into a deletion notification', async () => {
    const project = await createTempProject()
    vi.useFakeTimers()
    const listener = vi.fn()
    const error = vi.fn()
    const subscription = subscribeProjectFile(
      { root: project.root, storage: 'local', cachePolicy: 'none' },
      '/outside-project/note',
      listener,
      { onError: error },
    )
    cancellations.push(subscription.cancel)
    await vi.advanceTimersByTimeAsync(0)
    expect(listener).not.toHaveBeenCalled()
    expect(error).toHaveBeenCalledWith(expect.objectContaining({ code: 'EACCES' }))
  })
  it('shares direct-child membership interests without treating a child content edit as membership', async () => {
    const project = await createTempProject({ files: { 'docs/note.txt': 'first' } })
    vi.useFakeTimers()
    const context = { root: project.root, cachePolicy: 'none' as const, storage: 'local' as const }
    const listener = vi.fn()
    const second = vi.fn()
    const firstInterest = subscribeProjectDirectory(context, join(project.root, 'docs'), listener)
    const secondInterest = subscribeProjectDirectory(context, join(project.root, 'docs'), second)
    cancellations.push(firstInterest.cancel, secondInterest.cancel)
    await vi.advanceTimersByTimeAsync(0)
    await vi.waitFor(() => expect(listener).toHaveBeenCalledTimes(1))
    expect(second).toHaveBeenCalledTimes(1)
    await writeFile(join(project.root, 'docs/note.txt'), 'changed')
    await vi.advanceTimersByTimeAsync(1200)
    expect(listener).toHaveBeenCalledTimes(1)
    firstInterest.cancel()
    await mkdir(join(project.root, 'docs/new-child'))
    await vi.advanceTimersByTimeAsync(2300)
    await vi.waitFor(() => expect(second).toHaveBeenCalledTimes(2))
    expect(listener).toHaveBeenCalledTimes(1)
  })
})
