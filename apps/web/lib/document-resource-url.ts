/**
 * Convert a safe relative document URL to the asset endpoint of its bundle
 * (a Report's `report-assets` route, a wiki page's `wiki-assets` route).
 * Dot-segments are rejected before the browser gets a chance to normalize
 * them out of the endpoint prefix. The server independently performs lexical
 * and realpath containment checks.
 *
 * Lives in `lib` rather than beside the Markdown renderer because the wiki
 * component renderers need it too, and importing the renderer from a
 * component it renders would be circular.
 */
export function resolveDocumentResourceUrl(baseUrl: string, source: string): string | null {
  if (
    source.length === 0 ||
    source.startsWith('/') ||
    source.startsWith('#') ||
    source.startsWith('//') ||
    /^[a-z][a-z0-9+.-]*:/i.test(source)
  ) {
    return null
  }

  const match = /^([^?#]*)([?#][\s\S]*)?$/.exec(source)
  const rawPath = match?.[1] ?? source
  const suffix = match?.[2] ?? ''
  const rawSegments = rawPath.split('/')
  while (rawSegments[0] === '.') rawSegments.shift()
  if (rawSegments.length === 0 || rawSegments.some((segment) => segment.length === 0)) return null

  const encoded: string[] = []
  for (const raw of rawSegments) {
    let decoded: string
    try {
      decoded = decodeURIComponent(raw)
    } catch {
      return null
    }
    if (decoded === '.' || decoded === '..' || decoded.includes('/') || decoded.includes('\\')) {
      return null
    }
    encoded.push(encodeURIComponent(decoded))
  }
  const base = new URL(baseUrl, 'http://memon.invalid')
  if (base.origin !== 'http://memon.invalid') return null
  base.pathname = `${base.pathname.replace(/\/$/, '')}/${encoded.join('/')}`
  if (suffix) {
    const target = new URL(suffix, 'http://memon.invalid')
    for (const [name, value] of target.searchParams) base.searchParams.append(name, value)
    base.hash = target.hash
  }
  return `${base.pathname}${base.search}${base.hash}`
}
