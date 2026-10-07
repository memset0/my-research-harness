import type { DirectoryListResultSchema, FileReadResult } from '@memon/file-protocol'
import type { z } from 'zod'

type DirectoryResult = z.infer<typeof DirectoryListResultSchema>
type ObservationResult = FileReadResult | DirectoryResult

import { resolve } from '@memon/file-protocol/paths'
import type { ProjectFileContext } from '../project-file-context.js'
import { listProjectFiles, readProjectFile } from './conditional.js'
import { getStore } from './runtime.js'

interface Interest {
  listener: (result: ObservationResult) => void | Promise<void>
  error?: (error: unknown) => void
  expires: number
  version?: string
  present?: boolean
  delivering?: boolean
  pending?: ObservationResult
}
interface Channel {
  context: ProjectFileContext
  path: string
  interests: Set<Interest>
  timer?: NodeJS.Timeout
  running: boolean
  interval: number
  version?: string
  present?: boolean
  transient: boolean
  release: () => void
}
const CHANNELS = Symbol.for('memon.logical-file-interests.v1')
const carrier = globalThis as unknown as {
  [CHANNELS]?: { channels: Map<string, Channel>; interests: number }
}
carrier[CHANNELS] ??= { channels: new Map(), interests: 0 }
const shared = carrier[CHANNELS]
const channels = shared.channels
const MAX_INTERESTS = 4096

/** Central logical polling. A subscription is a leased interest, never a source watcher. */
function subscribeObservation(
  operation: 'readFile' | 'readdir',
  context: ProjectFileContext,
  path: string,
  listener: Interest['listener'],
  options: { knownVersion?: string; leaseMs?: number; onError?: Interest['error'] } = {},
) {
  if (shared.interests >= MAX_INTERESTS)
    throw Object.assign(new Error('subscription capacity reached'), { code: 'EBUSY' })
  const root = resolve(context.root)
  path = resolve(path)
  const leaseMs = options.leaseMs ?? 90_000
  if (!Number.isFinite(leaseMs) || leaseMs <= 0) throw new RangeError('invalid subscription lease')
  const key = `${root}\0${context.sourceIdentity ?? ''}\0${operation}\0${path}`
  let channel = channels.get(key)
  if (!channel) {
    const transient =
      context.cachePolicy === 'none' ||
      (context.cachePolicy === undefined && context.storage === 'local')
    channel = {
      context: {
        ...context,
        ...(transient ? { cachePolicy: 'memory' as const, persistentCache: false } : {}),
        root,
        reason: 'heartbeat',
        attentionId: `file-subscription-${channels.size}`,
      },
      path,
      interests: new Set(),
      running: false,
      interval: 1000,
      transient,
      release: getStore().registerLogicalInterest(root, path, operation),
    }
    channels.set(key, channel)
  }
  const interest: Interest = {
    listener,
    expires: performance.now() + leaseMs,
    ...(options.knownVersion ? { version: options.knownVersion, present: true } : {}),
    ...(options.onError ? { error: options.onError } : {}),
  }
  channel.interests.add(interest)
  shared.interests++
  const selected = channel
  let expiry: NodeJS.Timeout | undefined
  const remove = () => {
    if (expiry) clearTimeout(expiry)
    if (!selected.interests.delete(interest)) return
    shared.interests--
    interest.pending = undefined
    if (!selected.interests.size) {
      if (selected.timer) clearTimeout(selected.timer)
      if (channels.get(key) === selected) {
        channels.delete(key)
        selected.release()
      }
    }
  }
  const tick = async () => {
    selected.timer = undefined
    if (selected.running) return
    for (const item of selected.interests)
      if (item.expires <= performance.now()) {
        selected.interests.delete(item)
        shared.interests--
      }
    if (!selected.interests.size) {
      if (channels.get(key) === selected) {
        channels.delete(key)
        selected.release()
      }
      return
    }
    selected.running = true
    try {
      // Retain the common version only: native uncached bodies live for this dispatch alone.
      const result = await (operation === 'readFile' ? readProjectFile : listProjectFiles)(
        selected.context,
        selected.path,
        { policy: 'fresh' },
      )
      const present = result.outcome !== 'missing'
      const version = present ? result.version : undefined
      // The Store alone advances successful source-check backoff; cache hits do not.
      selected.interval = 1000
      selected.present = present
      selected.version = version
      for (const item of selected.interests) {
        if (item.present === present && item.version === version) continue
        item.present = present
        item.version = version
        // Slow listeners do not hold the source check or other subscribers.
        item.pending = result
        if (!item.delivering) {
          item.delivering = true
          void (async () => {
            try {
              while (item.pending && selected.interests.has(item)) {
                const next = item.pending
                item.pending = undefined
                try {
                  await item.listener(next)
                } catch (error) {
                  try {
                    item.error?.(error)
                  } catch {}
                }
              }
            } finally {
              item.delivering = false
              item.pending = undefined
            }
          })()
        }
      }
    } catch (error) {
      selected.interval = Math.min(300_000, selected.interval * 2)
      for (const item of selected.interests) {
        try {
          item.error?.(error)
        } catch {}
      }
    } finally {
      selected.running = false
      if (selected.transient) getStore().discardTransientBody(root, selected.path, operation)
      if (selected.interests.size && channels.get(key) === selected) {
        const due = getStore().nextCheckDelay(root, selected.path, operation)
        const delay = Math.max(selected.interval, due)
        selected.timer = setTimeout(() => void tick(), delay + Math.random() * delay * 0.1)
        selected.timer.unref()
      }
    }
  }
  if (!selected.timer && !selected.running) {
    selected.timer = setTimeout(() => void tick(), 0)
    selected.timer.unref()
  }
  const renew = () => {
    if (!selected.interests.has(interest)) return
    interest.expires = performance.now() + leaseMs
    if (expiry) clearTimeout(expiry)
    expiry = setTimeout(remove, leaseMs)
    expiry.unref()
  }
  renew()
  return { cancel: remove, renew }
}

export function subscribeProjectFile(
  context: ProjectFileContext,
  path: string,
  listener: (result: FileReadResult) => void | Promise<void>,
  options: { knownVersion?: string; leaseMs?: number; onError?: Interest['error'] } = {},
) {
  return subscribeObservation(
    'readFile',
    context,
    path,
    (result) => listener(result as FileReadResult),
    options,
  )
}

/** Direct members only. Child-content interests are independent and share the global bound. */
export function subscribeProjectDirectory(
  context: ProjectFileContext,
  path: string,
  listener: (result: DirectoryResult) => void | Promise<void>,
  options: { knownVersion?: string; leaseMs?: number; onError?: Interest['error'] } = {},
) {
  return subscribeObservation(
    'readdir',
    context,
    path,
    (result) => listener(result as DirectoryResult),
    options,
  )
}
