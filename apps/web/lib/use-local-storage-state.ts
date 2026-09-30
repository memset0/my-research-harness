'use client'

import { useEffect, useRef, useState } from 'react'

const WRITE_DEBOUNCE_MS = 250

function readStorage<T>(key: string, fallback: T): T {
  if (typeof window === 'undefined') return fallback
  try {
    const raw = window.localStorage.getItem(key)
    if (raw === null) return fallback
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

export function useLocalStorageState<T>(key: string, initial: T): [T, (next: T) => void] {
  const [value, setValue] = useState<T>(initial)
  const hydratedRef = useRef(false)

  useEffect(() => {
    if (hydratedRef.current) return
    hydratedRef.current = true
    setValue(readStorage<T>(key, initial))
  }, [key, initial])

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    if (!hydratedRef.current) return
    if (typeof window === 'undefined') return
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => {
      try {
        window.localStorage.setItem(key, JSON.stringify(value))
      } catch {
        // private mode / quota — drop silently, in-memory state is still correct
      }
    }, WRITE_DEBOUNCE_MS)
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [key, value])

  return [value, setValue]
}
