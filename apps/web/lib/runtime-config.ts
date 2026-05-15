// Client-side reader for the runtime config payload embedded in the
// document by `<RuntimeConfigBootstrap />`. Mirrors the session reader
// pattern: read the script tag once at mount, memoize, default-fallback
// when the tag is absent (e.g. unit tests without SSR).

'use client'

import { useMemo } from 'react'

export interface RuntimeConfigPayload {
  gitStatus: {
    intervalMs: number
  }
}

const DEFAULT_RUNTIME_CONFIG: RuntimeConfigPayload = {
  gitStatus: { intervalMs: 10_000 },
}

let cached: RuntimeConfigPayload | null = null

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
    cached = {
      gitStatus: {
        intervalMs:
          typeof intervalMs === 'number' && Number.isFinite(intervalMs) && intervalMs > 0
            ? intervalMs
            : DEFAULT_RUNTIME_CONFIG.gitStatus.intervalMs,
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
  // Stable reference across renders.
  return useMemo(() => readRuntimeConfig(), [])
}
