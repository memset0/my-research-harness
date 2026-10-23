import 'server-only'

/** A code-review key `<YYYY-MM-DD>-<slug>` from a route segment, or null. */
export function reviewKeyFromParam(segment: string): string | null {
  let key: string
  try {
    key = decodeURIComponent(segment)
  } catch {
    return null
  }
  return /^\d{4}-\d{2}-\d{2}-[a-z0-9][a-z0-9-]*$/.test(key) ? key : null
}
