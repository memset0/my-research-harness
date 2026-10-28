// Keep an embedded HTML document's location in the page URL.
//
// A static or live HTML Report/Wiki page navigates inside its iframe (`?tab=…`,
// `#/eval/…`, another page of the bundle). The page URL mirrors that location
// so it can be shared and reloaded: the fragment is the page's own fragment,
// and a path or query different from the entry document is kept in `view`,
// relative to the entry's directory. Locations outside that directory are
// never mirrored or restored.

export const EMBED_VIEW_PARAM = 'view'

/** The directory URL every mirrored location must stay within. */
function baseOf(entry: URL): URL {
  return new URL('./', entry)
}

/** The iframe URL for a page URL: `entry`, moved to its `view` and fragment. */
export function embedFrameSrc(src: string, page: URL): string {
  const entry = new URL(src, page)
  const base = baseOf(entry)
  const view = page.searchParams.get(EMBED_VIEW_PARAM)
  let target = new URL(entry)
  if (view) {
    const candidate = new URL(view, base)
    if (candidate.origin === base.origin && candidate.pathname.startsWith(base.pathname))
      target = candidate
  }
  target.hash = page.hash
  // Same-origin documents keep a relative URL, as the entry did.
  return target.origin === page.origin
    ? `${target.pathname}${target.search}${target.hash}`
    : target.href
}

/**
 * The page URL mirroring an iframe location, or `null` when the location is
 * outside the entry's directory (left unmirrored).
 */
export function pageUrlForFrame(src: string, frameHref: string, page: URL): URL | null {
  const entry = new URL(src, page)
  const base = baseOf(entry)
  const frame = new URL(frameHref, page)
  if (frame.origin !== base.origin || !frame.pathname.startsWith(base.pathname)) return null
  const next = new URL(page)
  const atEntry = frame.pathname === entry.pathname && frame.search === entry.search
  if (atEntry) next.searchParams.delete(EMBED_VIEW_PARAM)
  else
    next.searchParams.set(
      EMBED_VIEW_PARAM,
      `${frame.pathname.slice(base.pathname.length)}${frame.search}`,
    )
  next.hash = frame.hash
  return next
}
