// Client-side reader for the runtime config payload embedded in the
// document by `<RuntimeConfigBootstrap />`. Mirrors the session reader
// pattern: read the script tag once at mount, memoize, default-fallback
// when the tag is absent (e.g. unit tests without SSR).

'use client'

import { createContext, createElement, useContext, useMemo } from 'react'

export interface RuntimeConfigPayload {
  role: 'standalone' | 'central'
  gitStatus: {
    intervalMs: number
  }
  /** Foreground resource heartbeat cadence, from config `fileAccess`. */
  fileAccess: {
    heartbeatMs: number
  }
}

const DEFAULT_RUNTIME_CONFIG: RuntimeConfigPayload = {
  role: 'standalone',
  gitStatus: { intervalMs: 10_000 },
  fileAccess: { heartbeatMs: 30_000 },
}

let cached: RuntimeConfigPayload | null = null
const RuntimeConfigContext = createContext<RuntimeConfigPayload | null>(null)

export function readRuntimeConfig(): RuntimeConfigPayload {
  if (cached) return cached
  if (typeof document === 'undefined') {
    // SSR (in a server component) or non-browser context — return the
    // safe default. The actual server-side value is injected by
    // `<RuntimeConfigBootstrap />`, which doesn't need this reader.
    return DEFAULT_RUNTIME_CONFIG
  }
  const tag = document.getElementById('memon-runtime-config')
  const text = tag?.textContent
  if (!text) {
    cached = DEFAULT_RUNTIME_CONFIG
    return cached
  }
  try {
    const parsed = JSON.parse(text) as Partial<RuntimeConfigPayload>
    const intervalMs = parsed.gitStatus?.intervalMs
    const heartbeatMs = parsed.fileAccess?.heartbeatMs
    cached = {
      role: parsed.role === 'central' ? 'central' : 'standalone',
      gitStatus: {
        intervalMs:
          typeof intervalMs === 'number' && Number.isFinite(intervalMs) && intervalMs > 0
            ? intervalMs
            : DEFAULT_RUNTIME_CONFIG.gitStatus.intervalMs,
      },
      fileAccess: {
        heartbeatMs:
          typeof heartbeatMs === 'number' && Number.isFinite(heartbeatMs) && heartbeatMs > 0
            ? heartbeatMs
            : DEFAULT_RUNTIME_CONFIG.fileAccess.heartbeatMs,
      },
    }
    return cached
  } catch {
    cached = DEFAULT_RUNTIME_CONFIG
    return cached
  }
}

/** Test-only: clear the memoization between unit tests. */
export function __resetRuntimeConfigForTests(): void {
  cached = null
}

export function useRuntimeConfig(): RuntimeConfigPayload {
  const provided = useContext(RuntimeConfigContext)
  const fallback = useMemo(() => readRuntimeConfig(), [])
  return provided ?? fallback
}

export function RuntimeConfigProvider({
  value,
  children,
}: {
  value: RuntimeConfigPayload
  children: React.ReactNode
}) {
  return createElement(RuntimeConfigContext.Provider, { value }, children)
}
