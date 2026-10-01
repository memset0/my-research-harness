// @vitest-environment node

import { WIKI_KIND_REGISTRY } from '@memon/core'
import configuration from '@memon/core/wiki-kinds.json'
import { describe, expect, it, vi } from 'vitest'
import { wikiKinds } from '../../../../lib/wiki-kinds'
import { GET } from './route'

describe('Wiki kind API', () => {
  it('projects a config-only extension and edited text into API and Web', async () => {
    const fixture = structuredClone(configuration)
    const entry = structuredClone(fixture.kinds.find((kind) => kind.id === 'note')!)
    Object.assign(entry, { id: 'test-guide', order: 1000, relatedKinds: [] })
    entry.zh.purpose = '新的用途'
    entry.zh.examples = ['新的示例']
    fixture.kinds.push(entry)
    vi.resetModules()
    vi.doMock('@memon/core/wiki-kinds.json', () => ({ default: fixture }))
    try {
      const projection = await import('../../../../lib/wiki-kinds')
      expect(projection.wikiKindOrder).toContain('test-guide')
      expect(projection.wikiKinds.at(-1)?.zh).toEqual(entry.zh)
      const route = await import('./route')
      const payload = await (await route.GET()).json()
      expect(payload.kinds.at(-1).id).toBe('test-guide')
      expect(payload.kinds.at(-1).zh.purpose).toBe('新的用途')
    } finally {
      vi.doUnmock('@memon/core/wiki-kinds.json')
      vi.resetModules()
    }
  })

  it('exposes the same complete ordered definitions as Core and Web', async () => {
    const response = await GET()
    expect(await response.json()).toEqual(WIKI_KIND_REGISTRY)
    expect(wikiKinds).toEqual(WIKI_KIND_REGISTRY.kinds)
    expect(response.headers.get('Cache-Control')).toBe('no-store')
  })
})
