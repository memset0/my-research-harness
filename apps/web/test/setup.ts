// Extend vitest's `expect` with @testing-library/jest-dom matchers
// (`toBeInTheDocument`, `toHaveTextContent`, etc.).
import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach, vi } from 'vitest'

// vitest is configured with `globals: false`, so @testing-library/react does
// NOT auto-register its `afterEach(cleanup)` hook. Wire it up explicitly so
// each test starts with a fresh DOM.
afterEach(() => {
  cleanup()
})

// jsdom doesn't implement these — Radix UI primitives (Select, Dialog) reach
// for them. Stub once globally so any RTL test can use the shadcn primitives.
if (typeof window !== 'undefined') {
  // Node 26 exposes an experimental global `localStorage` accessor that is
  // undefined unless `--localstorage-file` is supplied. Install a small
  // spec-shaped in-memory Storage before components touch that accessor.
  const localValues = new Map<string, string>()
  const testLocalStorage: Storage = {
    get length() {
      return localValues.size
    },
    clear: () => localValues.clear(),
    getItem: (key) => localValues.get(String(key)) ?? null,
    key: (index) => Array.from(localValues.keys())[index] ?? null,
    removeItem: (key) => localValues.delete(String(key)),
    setItem: (key, value) => localValues.set(String(key), String(value)),
  }
  Object.defineProperty(window, 'localStorage', {
    configurable: true,
    value: testLocalStorage,
  })
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: testLocalStorage,
  })
  if (!('ResizeObserver' in window)) {
    // biome-ignore lint/suspicious/noExplicitAny: minimal stub
    ;(window as any).ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  }
  if (!Element.prototype.hasPointerCapture) {
    Element.prototype.hasPointerCapture = vi.fn(() => false)
  }
  if (!Element.prototype.releasePointerCapture) {
    Element.prototype.releasePointerCapture = vi.fn()
  }
  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = vi.fn()
  }
  if (!window.matchMedia) {
    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }))
  }
  // Inert EventSource — tests can override per-suite if they want to drive
  // SSE events; default is "open succeeds, never emits".
  if (!('EventSource' in window)) {
    // biome-ignore lint/suspicious/noExplicitAny: stub class
    ;(window as any).EventSource = class {
      url: string
      readyState = 0
      onopen: ((e: Event) => void) | null = null
      onmessage: ((e: MessageEvent) => void) | null = null
      onerror: ((e: Event) => void) | null = null
      constructor(url: string) {
        this.url = url
      }
      addEventListener() {}
      removeEventListener() {}
      close() {}
    }
  }
}
