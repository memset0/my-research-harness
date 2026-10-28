// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { embedFrameSrc, pageUrlForFrame } from './embed-location'

const PAGE = 'https://memon.test/host-a/project-a/r/23'
const SERVICE = '/api/content-services/host-a/project-a/report/R0023/'
const HTML = '/api/content-assets/host-a/project-a/report/R0022/index.html'

describe('embed location in the page URL', () => {
  it('mirrors fragments and in-bundle views, and clears them at the entry', () => {
    const page = new URL(`${PAGE}?expanded=1`)
    const hashed = pageUrlForFrame(SERVICE, `https://memon.test${SERVICE}#/eval/run-1`, page)
    expect(hashed?.href).toBe(`${PAGE}?expanded=1#/eval/run-1`)
    const viewed = pageUrlForFrame(
      HTML,
      `https://memon.test${HTML.replace('index.html', 'pages/b.html')}?tab=x#top`,
      page,
    )
    expect(viewed?.searchParams.get('view')).toBe('pages/b.html?tab=x')
    expect(viewed?.hash).toBe('#top')
    expect(viewed?.searchParams.get('expanded')).toBe('1')
    const back = pageUrlForFrame(HTML, `https://memon.test${HTML}`, viewed!)
    expect(back?.href).toBe(`${PAGE}?expanded=1`)
  })

  it('restores the frame from the page URL and ignores views outside the bundle', () => {
    expect(embedFrameSrc(SERVICE, new URL(`${PAGE}#/eval/run-1`))).toBe(`${SERVICE}#/eval/run-1`)
    expect(embedFrameSrc(HTML, new URL(`${PAGE}?view=pages%2Fb.html%3Ftab%3Dx#top`))).toBe(
      `${HTML.replace('index.html', 'pages/b.html')}?tab=x#top`,
    )
    expect(embedFrameSrc(HTML, new URL(`${PAGE}?view=..%2F..%2Fsecret`))).toBe(HTML)
    expect(embedFrameSrc(HTML, new URL(`${PAGE}?view=https%3A%2F%2Fevil.test%2F`))).toBe(HTML)
    expect(pageUrlForFrame(HTML, 'https://memon.test/elsewhere', new URL(PAGE))).toBeNull()
  })
})
