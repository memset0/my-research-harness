// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { __resetRuntimeConfigForTests, readRuntimeConfig } from './runtime-config'

function injectScript(payload: unknown): void {
  const existing = document.getElementById('memon-runtime-config')
  if (existing) existing.remove()
  const tag = document.createElement('script')
  tag.id = 'memon-runtime-config'
  tag.type = 'application/json'
  tag.textContent = typeof payload === 'string' ? payload : JSON.stringify(payload)
  document.head.appendChild(tag)
}

beforeEach(() => {
  __resetRuntimeConfigForTests()
  document.getElementById('memon-runtime-config')?.remove()
})

afterEach(() => {
  __resetRuntimeConfigForTests()
  document.getElementById('memon-runtime-config')?.remove()
})

describe('readRuntimeConfig', () => {
  it('returns the injected intervalMs when the script tag is present', () => {
    injectScript({
      gitStatus: { intervalMs: 30_000 },
      terminal: { tmuxEnabled: false, herdrEnabled: true },
    })
    const config = readRuntimeConfig()
    expect(config.gitStatus.intervalMs).toBe(30_000)
    expect(config.terminal).toEqual({ tmuxEnabled: false, herdrEnabled: true })
  })

  it('falls back to 10_000 when the script tag is absent', () => {
    expect(readRuntimeConfig()).toEqual({
      gitStatus: { intervalMs: 10_000 },
      terminal: { tmuxEnabled: true, herdrEnabled: false },
    })
  })

  it('falls back to 10_000 when the script tag holds invalid JSON', () => {
    injectScript('{not-json')
    expect(readRuntimeConfig().gitStatus.intervalMs).toBe(10_000)
  })

  it('falls back to 10_000 when gitStatus.intervalMs is missing', () => {
    injectScript({ other: 'value' })
    expect(readRuntimeConfig().gitStatus.intervalMs).toBe(10_000)
  })

  it('falls back to 10_000 when intervalMs is non-positive', () => {
    injectScript({ gitStatus: { intervalMs: 0 } })
    expect(readRuntimeConfig().gitStatus.intervalMs).toBe(10_000)
  })

  it('memoizes the result across reads within one render lifetime', () => {
    injectScript({ gitStatus: { intervalMs: 15_000 } })
    const a = readRuntimeConfig()
    // Mutate the script tag — the cached value should not change.
    injectScript({ gitStatus: { intervalMs: 99_999 } })
    const b = readRuntimeConfig()
    expect(b).toBe(a)
    expect(b.gitStatus.intervalMs).toBe(15_000)
  })
})
