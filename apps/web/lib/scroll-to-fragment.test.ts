import { afterEach, describe, expect, it } from 'vitest'
import {
  findOwningScroller,
  resetDriftedAncestors,
  scrollFragmentIntoSurface,
} from './scroll-to-fragment'

function rect(el: Element, top: number) {
  Object.defineProperty(el, 'getBoundingClientRect', {
    configurable: true,
    value: () => ({ top, bottom: top + 10, left: 0, right: 0, width: 0, height: 10, x: 0, y: top }),
  })
}

function scrollable(el: HTMLElement, scrollHeight: number, clientHeight: number) {
  el.style.overflowY = 'auto'
  Object.defineProperty(el, 'scrollHeight', { configurable: true, value: scrollHeight })
  Object.defineProperty(el, 'clientHeight', { configurable: true, value: clientHeight })
}

afterEach(() => {
  document.body.innerHTML = ''
})

describe('scrollFragmentIntoSurface', () => {
  it('moves only the nearest user-scrollable ancestor and honours scroll-margin-top', () => {
    document.body.innerHTML = `
      <div id="inset" style="overflow:hidden"><div id="outer"><div id="surface"><h2 id="target">T</h2></div></div></div>`
    const inset = document.getElementById('inset')!
    const outer = document.getElementById('outer')!
    const surface = document.getElementById('surface')!
    const target = document.getElementById('target')!
    scrollable(outer, 2000, 800)
    scrollable(surface, 3000, 700)
    inset.scrollTop = 0
    outer.scrollTop = 40
    surface.scrollTop = 100
    rect(surface, 50)
    rect(target, 650)
    target.style.scrollMarginTop = '64px'

    expect(findOwningScroller(target)).toBe(surface)
    expect(scrollFragmentIntoSurface('target')).toBe(true)
    expect(surface.scrollTop).toBe(100 + 650 - 50 - 64)
    expect(outer.scrollTop).toBe(40)
    expect(inset.scrollTop).toBe(0)
  })

  it('reports a missing target so callers fall back to native navigation', () => {
    expect(scrollFragmentIntoSurface('nope')).toBe(false)
  })
})

describe('resetDriftedAncestors', () => {
  it('zeroes every ancestor offset left by the load-time hash scroll', () => {
    document.body.innerHTML = `
      <div id="inset" style="overflow:hidden"><div id="outer"><div id="surface"></div></div></div>`
    const inset = document.getElementById('inset')!
    const outer = document.getElementById('outer')!
    scrollable(outer, 2000, 800)
    inset.scrollTop = 57
    outer.scrollTop = 32
    resetDriftedAncestors(document.getElementById('surface')!)
    expect(inset.scrollTop).toBe(0)
    expect(outer.scrollTop).toBe(0)
  })
})
