/**
 * Fragment navigation that scrolls only the pane owning the target.
 *
 * Native `#id` navigation (and `Element.scrollIntoView`) scrolls *every*
 * scrollable ancestor, including `overflow-hidden` layout clippers the user
 * can never wheel back. Inside the fixed-height app shell that leaves the
 * sidebar inset and the project content scroller permanently offset. This
 * helper moves just the nearest wheel-scrollable ancestor and leaves the
 * rest of the document alone.
 */

const SCROLLABLE_OVERFLOW: Record<string, true> = { auto: true, scroll: true }

/** Nearest ancestor a user can actually scroll, or `null` for the viewport. */
export function findOwningScroller(target: Element): HTMLElement | null {
  let node = target.parentElement
  while (node && node !== document.body && node !== document.documentElement) {
    const overflowY = getComputedStyle(node).overflowY
    if (SCROLLABLE_OVERFLOW[overflowY] && node.scrollHeight > node.clientHeight) return node
    node = node.parentElement
  }
  return null
}

function scrollMarginTop(target: Element): number {
  const value = parseFloat(getComputedStyle(target).scrollMarginTop)
  return Number.isFinite(value) ? value : 0
}

/**
 * Scroll the owning pane so `id` lands at its top (respecting the target's
 * `scroll-margin-top`). Returns `false` when the id is absent so callers can
 * fall back to native navigation.
 */
export function scrollFragmentIntoSurface(id: string): boolean {
  if (!id) return false
  const target = document.getElementById(id)
  if (!target) return false
  const scroller = findOwningScroller(target)
  const margin = scrollMarginTop(target)
  if (!scroller) {
    window.scrollTo({ top: window.scrollY + target.getBoundingClientRect().top - margin })
    return true
  }
  const delta = target.getBoundingClientRect().top - scroller.getBoundingClientRect().top - margin
  scroller.scrollTop += delta
  return true
}

/**
 * Undo native hash navigation that already dragged the pane's ancestors:
 * the load-time hash scroll runs before hydration, and at mount time nothing
 * else can have scrolled them, so every offset above the surface is drift.
 */
export function resetDriftedAncestors(surface: Element): void {
  let node = surface.parentElement
  while (node) {
    if (node.scrollTop !== 0) node.scrollTop = 0
    node = node.parentElement
  }
}

/**
 * Click handler for same-document `#fragment` anchors. Leaves modified clicks
 * and unknown targets to the browser.
 */
export function handleFragmentClick(
  event: React.MouseEvent<HTMLAnchorElement>,
  href: string,
): void {
  if (!href.startsWith('#')) return
  if (event.defaultPrevented || event.button !== 0) return
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
  const id = decodeURIComponent(href.slice(1))
  if (!scrollFragmentIntoSurface(id)) return
  event.preventDefault()
  history.replaceState(history.state, '', `#${encodeURIComponent(id)}`)
}
