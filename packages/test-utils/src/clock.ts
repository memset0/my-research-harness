import { vi } from 'vitest'

/**
 * Freeze `Date` (and `Date.now()`) at `at` while leaving timers real, so
 * polling and `setTimeout`-based code keeps running. Returns `restore()`.
 */
export function useFixedClock(at: string | number | Date): () => void {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(at instanceof Date ? at : new Date(at))
  return () => {
    vi.useRealTimers()
  }
}
