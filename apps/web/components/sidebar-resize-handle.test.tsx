import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render } from '@testing-library/react'
import { SidebarResizeHandle } from './sidebar-resize-handle'
import { SidebarProvider } from './ui/sidebar'
import { MAX_PX, STORAGE_KEY } from '../hooks/use-sidebar-width'

// Helper: set viewport size and stub matchMedia to track it. The shadcn
// primitive's `useIsMobile()` reads `window.innerWidth` + listens on
// `window.matchMedia('(max-width: 767px)')`.
function setViewport(width: number) {
  Object.defineProperty(window, 'innerWidth', {
    configurable: true,
    value: width,
    writable: true,
  })
  window.matchMedia = vi.fn().mockImplementation((query: string) => {
    const m = /max-width:\s*(\d+)/.exec(query)
    const matches = m ? width <= Number.parseInt(m[1] ?? '0', 10) : false
    return {
      matches,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }
  })
}

function renderInProvider(open = true) {
  return render(
    <SidebarProvider defaultOpen={open}>
      <SidebarResizeHandle />
    </SidebarProvider>,
  )
}

describe('SidebarResizeHandle', () => {
  beforeEach(() => {
    localStorage.clear()
    setViewport(1280)
  })
  afterEach(() => {
    localStorage.clear()
  })

  it('renders the handle when desktop + expanded', () => {
    const { container } = renderInProvider(true)
    const handle = container.querySelector('[data-slot="sidebar-resize-handle"]')
    expect(handle).not.toBeNull()
    expect(handle?.tagName).toBe('HR')
    expect(handle?.getAttribute('aria-orientation')).toBe('vertical')
    expect(handle?.getAttribute('aria-label')).toBe('Resize sidebar')
    expect(handle?.getAttribute('tabindex')).toBe('0')
  })

  it('returns null on mobile viewports (< 768px)', () => {
    setViewport(500)
    const { container } = renderInProvider(true)
    expect(container.querySelector('[data-slot="sidebar-resize-handle"]')).toBeNull()
  })

  it('returns null when sidebar is collapsed', () => {
    const { container } = renderInProvider(false)
    expect(container.querySelector('[data-slot="sidebar-resize-handle"]')).toBeNull()
  })

  it('ArrowRight increments width by 16 and persists', () => {
    const { container } = renderInProvider(true)
    const handle = container.querySelector('[data-slot="sidebar-resize-handle"]') as HTMLElement
    expect(handle).not.toBeNull()
    // Starts at DEFAULT_PX = 256
    fireEvent.keyDown(handle, { key: 'ArrowRight' })
    expect(localStorage.getItem(STORAGE_KEY)).toBe('272')
    fireEvent.keyDown(handle, { key: 'ArrowRight' })
    expect(localStorage.getItem(STORAGE_KEY)).toBe('288')
  })

  it('ArrowLeft decrements width by 16 and persists', () => {
    const { container } = renderInProvider(true)
    const handle = container.querySelector('[data-slot="sidebar-resize-handle"]') as HTMLElement
    fireEvent.keyDown(handle, { key: 'ArrowLeft' })
    expect(localStorage.getItem(STORAGE_KEY)).toBe('240')
  })

  it('Shift+ArrowRight takes a 64px step', () => {
    const { container } = renderInProvider(true)
    const handle = container.querySelector('[data-slot="sidebar-resize-handle"]') as HTMLElement
    fireEvent.keyDown(handle, { key: 'ArrowRight', shiftKey: true })
    expect(localStorage.getItem(STORAGE_KEY)).toBe('320')
  })

  it('clamps at MAX_PX when arrowing past the upper bound', () => {
    // Pre-seed near the max so a single shift+arrow blows past it.
    localStorage.setItem(STORAGE_KEY, '370')
    const { container } = renderInProvider(true)
    const handle = container.querySelector('[data-slot="sidebar-resize-handle"]') as HTMLElement
    // After mount + hydration the handle's hook reads 370. Shift+arrow
    // would otherwise yield 434; expect clamp to 384.
    fireEvent.keyDown(handle, { key: 'ArrowRight', shiftKey: true })
    expect(localStorage.getItem(STORAGE_KEY)).toBe(String(MAX_PX))
  })

  it('clamps at MIN_PX when arrowing past the lower bound', () => {
    localStorage.setItem(STORAGE_KEY, '200')
    const { container } = renderInProvider(true)
    const handle = container.querySelector('[data-slot="sidebar-resize-handle"]') as HTMLElement
    fireEvent.keyDown(handle, { key: 'ArrowLeft', shiftKey: true })
    expect(localStorage.getItem(STORAGE_KEY)).toBe('192')
  })
})
