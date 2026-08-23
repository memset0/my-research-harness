'use client'

import { type SetStateAction, useCallback, useEffect, useRef, useState } from 'react'

type ServerState = 'pending' | 'enabled' | 'browser-only' | 'unavailable'

interface LocalPreference<T> {
  found: boolean
  value: T
}

interface LocalSyncState {
  version: 1
  dirty: boolean
  mutationId?: string
  serverUpdatedAt?: number
}

type ServerPreference<T> = { found: false } | { found: true; value: T; updatedAt: number }

type ServerReadResult<T> =
  | { status: 'available'; preference: ServerPreference<T> }
  | { status: 'browser-only' }
  | { status: 'unavailable' }

type ServerWriteResult =
  | { status: 'saved'; updatedAt: number }
  | { status: 'browser-only' }
  | { status: 'unavailable' }

const LOCAL_SYNC_KEY_PREFIX = 'memon:ui-preference-sync:'
const serverWriteChains = new Map<string, Promise<ServerWriteResult>>()
const serverWritesByMutation = new Map<string, Promise<ServerWriteResult>>()
let mutationSequence = 0

function localSyncKey(key: string): string {
  return `${LOCAL_SYNC_KEY_PREFIX}${key}`
}

function readLocalPreference<T>(key: string, fallback: T): LocalPreference<T> {
  if (typeof window === 'undefined') return { found: false, value: fallback }
  try {
    const raw = window.localStorage.getItem(key)
    if (raw === null) return { found: false, value: fallback }
    return { found: true, value: JSON.parse(raw) as T }
  } catch {
    return { found: false, value: fallback }
  }
}

function readLocalPreferenceJson(key: string): string | null {
  if (typeof window === 'undefined') return null
  try {
    return window.localStorage.getItem(key)
  } catch {
    return null
  }
}

function serializePreference<T>(value: T): string | null {
  try {
    const serialized = JSON.stringify(value)
    return typeof serialized === 'string' ? serialized : null
  } catch {
    return null
  }
}

function writeLocalPreferenceJson(key: string, serialized: string): boolean {
  if (typeof window === 'undefined') return false
  try {
    window.localStorage.setItem(key, serialized)
    return true
  } catch {
    return false
  }
}

function readLocalSyncState(key: string): LocalSyncState | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.localStorage.getItem(localSyncKey(key))
    if (raw === null) return null
    const value = JSON.parse(raw) as Partial<LocalSyncState>
    if (value.version !== 1 || typeof value.dirty !== 'boolean') return null
    return {
      version: 1,
      dirty: value.dirty,
      ...(typeof value.mutationId === 'string' && value.mutationId.length > 0
        ? { mutationId: value.mutationId }
        : {}),
      ...(typeof value.serverUpdatedAt === 'number' && Number.isFinite(value.serverUpdatedAt)
        ? { serverUpdatedAt: value.serverUpdatedAt }
        : {}),
    }
  } catch {
    return null
  }
}

function writeLocalSyncState(key: string, state: LocalSyncState): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(localSyncKey(key), JSON.stringify(state))
  } catch {
    // The raw local value remains the browser fallback if metadata cannot be stored.
  }
}

function removeLocalSyncState(key: string): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.removeItem(localSyncKey(key))
  } catch {
    // Nothing else can be done when browser storage is unavailable.
  }
}

function nextMutationId(): string {
  mutationSequence += 1
  const randomId = globalThis.crypto?.randomUUID?.()
  return randomId ?? `${Date.now().toString(36)}-${mutationSequence.toString(36)}`
}

function writeServerHydration<T>(key: string, value: T, updatedAt: number): void {
  const serialized = serializePreference(value)
  if (serialized === null) return

  const previousJson = readLocalPreferenceJson(key)
  const previousSync = readLocalSyncState(key)
  if (!writeLocalPreferenceJson(key, serialized)) return
  writeLocalSyncState(key, {
    version: 1,
    dirty: false,
    ...(previousJson === serialized && previousSync?.mutationId
      ? { mutationId: previousSync.mutationId }
      : {}),
    serverUpdatedAt: updatedAt,
  })
}

async function readServerPreference<T>(key: string): Promise<ServerReadResult<T>> {
  try {
    const response = await fetch(`/api/ui-preferences?key=${encodeURIComponent(key)}`, {
      cache: 'no-store',
      credentials: 'same-origin',
      headers: { Accept: 'application/json' },
    })
    if (response.status === 401 || response.status === 403) return { status: 'browser-only' }
    if (!response.ok) return { status: 'unavailable' }

    const body = (await response.json()) as {
      found?: unknown
      value?: T
      updatedAt?: unknown
    }
    if (body.found === false) {
      return { status: 'available', preference: { found: false } }
    }
    if (
      body.found !== true ||
      !Object.hasOwn(body, 'value') ||
      typeof body.updatedAt !== 'number' ||
      !Number.isFinite(body.updatedAt)
    ) {
      return { status: 'unavailable' }
    }
    return {
      status: 'available',
      preference: { found: true, value: body.value as T, updatedAt: body.updatedAt },
    }
  } catch {
    return { status: 'unavailable' }
  }
}

async function writeServerPreference<T>(key: string, value: T): Promise<ServerWriteResult> {
  try {
    const response = await fetch('/api/ui-preferences', {
      method: 'PUT',
      cache: 'no-store',
      credentials: 'same-origin',
      keepalive: true,
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ key, value }),
    })
    if (response.status === 401 || response.status === 403) return { status: 'browser-only' }
    if (!response.ok) return { status: 'unavailable' }

    const body = (await response.json()) as { updatedAt?: unknown }
    if (typeof body.updatedAt !== 'number' || !Number.isFinite(body.updatedAt)) {
      return { status: 'unavailable' }
    }
    return { status: 'saved', updatedAt: body.updatedAt }
  } catch {
    return { status: 'unavailable' }
  }
}

function acknowledgeServerWrite<T>(
  key: string,
  valueJson: string,
  mutationId: string,
  updatedAt: number,
): void {
  const currentJson = readLocalPreferenceJson(key)
  const currentSync = readLocalSyncState(key)
  if (currentJson === valueJson && currentSync?.mutationId === mutationId) {
    writeLocalSyncState(key, {
      version: 1,
      dirty: false,
      mutationId,
      serverUpdatedAt: updatedAt,
    })
    return
  }

  // A different mutation became current while this request was in flight.
  // Reassert that browser-newest snapshot in case this older request reached
  // SQLite after the newer request from another hook or tab.
  if (currentJson !== null && currentSync?.mutationId) {
    try {
      void enqueueServerPreferenceWrite(key, JSON.parse(currentJson) as T, currentSync.mutationId)
    } catch {
      // A malformed browser record will be reconciled by normal hydration.
    }
  }
}

function enqueueServerPreferenceWrite<T>(
  key: string,
  value: T,
  mutationId: string,
): Promise<ServerWriteResult> {
  const mutationKey = `${key}\u0000${mutationId}`
  const existing = serverWritesByMutation.get(mutationKey)
  if (existing) return existing

  const valueJson = serializePreference(value)
  if (valueJson === null) return Promise.resolve({ status: 'unavailable' })

  const previous =
    serverWriteChains.get(key) ??
    Promise.resolve<ServerWriteResult>({
      status: 'saved',
      updatedAt: 0,
    })
  const request = previous
    .catch((): ServerWriteResult => ({ status: 'unavailable' }))
    .then(() => writeServerPreference(key, value))

  let tracked: Promise<ServerWriteResult>
  tracked = request
    .then((result) => {
      if (result.status === 'saved') {
        acknowledgeServerWrite<T>(key, valueJson, mutationId, result.updatedAt)
      }
      return result
    })
    .finally(() => {
      if (serverWritesByMutation.get(mutationKey) === tracked) {
        serverWritesByMutation.delete(mutationKey)
      }
      if (serverWriteChains.get(key) === tracked) serverWriteChains.delete(key)
    })

  serverWritesByMutation.set(mutationKey, tracked)
  serverWriteChains.set(key, tracked)
  return tracked
}

/**
 * Browser-first preference state with owner-only SQLite reconciliation.
 *
 * A durable dirty marker proves that a present browser value came from a real
 * user mutation and remains authoritative until that exact mutation is
 * acknowledged. A missing or clean browser record accepts server hydration.
 */
export function useUserPreferenceState<T>(
  key: string,
  initial: T,
): [T, (next: SetStateAction<T>) => void] {
  const [value, setValue] = useState<T>(initial)
  const initialRef = useRef(initial)
  const valueRef = useRef(value)
  const serverStateRef = useRef<ServerState>('pending')
  const changedWhilePendingRef = useRef(false)
  const latestMutationIdRef = useRef<string | null>(null)
  const generationRef = useRef(0)

  const enqueueServerWrite = useCallback(
    (next: T, mutationId: string) => {
      const generation = generationRef.current
      void enqueueServerPreferenceWrite(key, next, mutationId).then((result) => {
        if (generation !== generationRef.current) return
        if (result.status === 'saved') serverStateRef.current = 'enabled'
        else if (result.status === 'browser-only') serverStateRef.current = 'browser-only'
        else serverStateRef.current = 'unavailable'
      })
    },
    [key],
  )

  useEffect(() => {
    const generation = generationRef.current + 1
    generationRef.current = generation
    serverStateRef.current = 'pending'
    changedWhilePendingRef.current = false

    const local = readLocalPreference(key, initialRef.current)
    const localSync = local.found ? readLocalSyncState(key) : null
    if (!local.found) removeLocalSyncState(key)
    valueRef.current = local.value
    latestMutationIdRef.current = localSync?.dirty ? (localSync.mutationId ?? null) : null
    setValue(local.value)

    if (local.found && localSync?.dirty && localSync.mutationId) {
      enqueueServerWrite(local.value, localSync.mutationId)
    }

    void readServerPreference<T>(key).then((server) => {
      if (generation !== generationRef.current) return
      if (server.status === 'browser-only') {
        serverStateRef.current = 'browser-only'
        return
      }
      if (server.status === 'unavailable') {
        serverStateRef.current = 'unavailable'
        return
      }

      serverStateRef.current = 'enabled'
      const currentLocal = readLocalPreference(key, valueRef.current)
      const currentSync = currentLocal.found ? readLocalSyncState(key) : null
      const dirtyMutationId =
        currentLocal.found && currentSync?.dirty
          ? currentSync.mutationId
          : changedWhilePendingRef.current && !currentSync
            ? (latestMutationIdRef.current ?? undefined)
            : undefined

      if (dirtyMutationId) {
        enqueueServerWrite(
          currentLocal.found ? currentLocal.value : valueRef.current,
          dirtyMutationId,
        )
        return
      }

      if (server.preference.found) {
        if (
          currentLocal.found &&
          currentSync?.serverUpdatedAt !== undefined &&
          server.preference.updatedAt <= currentSync.serverUpdatedAt
        ) {
          return
        }

        const authoritativeValue = server.preference.value
        changedWhilePendingRef.current = false
        latestMutationIdRef.current = null
        valueRef.current = authoritativeValue
        writeServerHydration(key, authoritativeValue, server.preference.updatedAt)
        setValue(authoritativeValue)
        return
      }

      // A missing server row is different from an empty value. Existing clean
      // browser state remains active and is migrated, but is not labelled as a
      // user mutation merely because SQLite has no row.
      if (!currentLocal.found || currentSync?.serverUpdatedAt !== undefined) return
      const mutationId = nextMutationId()
      latestMutationIdRef.current = mutationId
      writeLocalSyncState(key, {
        version: 1,
        dirty: false,
        mutationId,
      })
      enqueueServerWrite(currentLocal.value, mutationId)
    })

    return () => {
      if (generation === generationRef.current) generationRef.current += 1
    }
  }, [enqueueServerWrite, key])

  const update = useCallback(
    (action: SetStateAction<T>) => {
      const next =
        typeof action === 'function' ? (action as (previous: T) => T)(valueRef.current) : action
      const currentJson = serializePreference(valueRef.current)
      const nextJson = serializePreference(next)
      if (nextJson === null || nextJson === currentJson) return

      const mutationId = nextMutationId()
      const previousSync = readLocalSyncState(key)
      valueRef.current = next
      latestMutationIdRef.current = mutationId
      changedWhilePendingRef.current = serverStateRef.current === 'pending'
      setValue(next)
      if (writeLocalPreferenceJson(key, nextJson)) {
        writeLocalSyncState(key, {
          version: 1,
          dirty: true,
          mutationId,
          ...(previousSync?.serverUpdatedAt !== undefined
            ? { serverUpdatedAt: previousSync.serverUpdatedAt }
            : {}),
        })
      }

      if (serverStateRef.current !== 'browser-only') enqueueServerWrite(next, mutationId)
    },
    [enqueueServerWrite, key],
  )

  return [value, update]
}
