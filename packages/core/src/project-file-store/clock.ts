// project-file-store/clock — the monotonic clock every scheduling decision uses.

export function monotonic(): number {
  return performance.now()
}
