'use client'

import { type SetStateAction, useCallback, useEffect, useRef, useState } from 'react'

type ServerState = 'pending' | 'enabled' | 'disabled'

interface LocalPreference<T> {
  found: boolean
  value: T
}

interface ServerPreference<T> {
  found: boolean
  value?: T
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

function writeLocalPreference<T>(key: string, value: T): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // Private mode / quota: mounted in-memory state still works.
  }
}

async function readServerPreference<T>(key: string): Promise<ServerPreference<T> | null> {
  try {
    const response = await fetch(`/api/ui-preferences?key=${encodeURIComponent(key)}`, {
      cache: 'no-store',
      credentials: 'same-origin',
      headers: { Accept: 'application/json' },
    })
    if (!response.ok) return null
    const body = (await response.json()) as ServerPreference<T>
    if (typeof body.found !== 'boolean') return null
    if (body.found && !Object.hasOwn(body, 'value')) return null
    return body
  } catch {
    return null
  }
}

async function writeServerPreference<T>(key: string, value: T): Promise<boolean> {
  try {
    const response = await fetch('/api/ui-preferences', {
      method: 'PUT',
      cache: 'no-store',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ key, value }),
    })
    return response.ok
  } catch {
    return false
  }
}

/**
 * Browser-first preference state with owner-only SQLite reconciliation.
 *
 * A present server row is authoritative even when its value contains empty
 * filters. A missing server row is different: an existing browser value wins
 * and is migrated to SQLite. Viewer/anonymous responses disable server writes.
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
  const writeChainRef = useRef<Promise<unknown>>(Promise.resolve())
  const generationRef = useRef(0)

  const enqueueServerWrite = useCallback(
    (next: T) => {
      const generation = generationRef.current
      writeChainRef.current = writeChainRef.current
        .catch(() => undefined)
        .then(async () => {
          if (generation !== generationRef.current || serverStateRef.current !== 'enabled') return
          const ok = await writeServerPreference(key, next)
          if (!ok && generation === generationRef.current) serverStateRef.current = 'disabled'
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
    valueRef.current = local.value
    setValue(local.value)

    void readServerPreference<T>(key).then((server) => {
      if (generation !== generationRef.current) return
      if (!server) {
        serverStateRef.current = 'disabled'
        return
      }

      serverStateRef.current = 'enabled'
      if (server.found) {
        if (changedWhilePendingRef.current) {
          changedWhilePendingRef.current = false
          enqueueServerWrite(valueRef.current)
          return
        }
        const authoritativeValue = server.value as T
        changedWhilePendingRef.current = false
        valueRef.current = authoritativeValue
        writeLocalPreference(key, authoritativeValue)
        setValue(authoritativeValue)
        return
      }

      // No SQLite row is not the same as a saved empty value. Migrate only an
      // existing browser record, using its latest value if the user interacted
      // while the GET was in flight.
      if (local.found || changedWhilePendingRef.current) {
        changedWhilePendingRef.current = false
        enqueueServerWrite(valueRef.current)
      }
    })

    return () => {
      if (generation === generationRef.current) generationRef.current += 1
    }
  }, [enqueueServerWrite, key])

  const update = useCallback(
    (action: SetStateAction<T>) => {
      const next =
        typeof action === 'function' ? (action as (previous: T) => T)(valueRef.current) : action
      valueRef.current = next
      setValue(next)
      writeLocalPreference(key, next)
      if (serverStateRef.current === 'enabled') enqueueServerWrite(next)
      else if (serverStateRef.current === 'pending') changedWhilePendingRef.current = true
    },
    [enqueueServerWrite, key],
  )

  return [value, update]
}
