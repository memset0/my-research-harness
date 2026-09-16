// @vitest-environment node

import { describe, expect, it } from 'vitest'
import { listComponentBlocks, lintComponents, validatePayload } from './registry'

describe('component registry', () => {
  it('resolves unpinned blocks to latest and warns', () => {
    const [block] = listComponentBlocks('```yaml figure\nimage: x.svg\ncaption: X\n```')
    expect(block).toMatchObject({ type: 'figure', version: 1, pinnedVersion: null, latestVersion: 1, outdated: false })
    expect(block?.diagnostics.map((item) => item.code)).toEqual(['WIKI_COMPONENT_UNPINNED'])
  })

  it('reports unknown type, unknown version, invalid info, and executable blocks without id', () => {
    const body = [
      '```yaml absent@1\nx: 1\n```',
      '```yaml figure@9\nimage: x\ncaption: X\n```',
      '```yaml figure@1 #x extra\nimage: x\ncaption: X\n```',
      '```yaml datatable@1\nscript: collect.py::main\n```',
    ].join('\n')
    expect(lintComponents(body).filter((item) => item.code === 'WIKI_COMPONENT_INVALID')).toHaveLength(4)
    expect(lintComponents(body).at(-1)?.message).toContain('needs #<id>')
  })

  it('marks repeated ids without discarding otherwise valid data', () => {
    const body = [
      '```yaml figure@1 #same\nimage: one.svg\ncaption: One\n```',
      '```yaml figure@1 #same\nimage: two.svg\ncaption: Two\n```',
    ].join('\n')
    const blocks = listComponentBlocks(body)
    expect(blocks[1]?.data).toMatchObject({ caption: 'Two' })
    expect(blocks[1]?.diagnostics.at(-1)?.code).toBe('COMPONENT_ID_DUPLICATE')
  })

  it('maps zod paths and unrecognized keys to readable fields', () => {
    const badView = validatePayload('datatable', 1, {
      columns: ['step', 'fid'], data: [[1, 2]], views: [{ type: 'line', x: 'epoch', y: 'fid' }],
    })
    expect(badView).toMatchObject({ ok: false, field: 'views[0].x' })
    expect(validatePayload('figure', 1, { image: 'x', caption: 'X', mystery: true })).toMatchObject({ ok: false, field: 'mystery' })
  })

  it('strips cache metadata before validating payloads', () => {
    expect(validatePayload('figure', 1, { image: 'x', caption: 'X', __component_id: 'x' })).toMatchObject({ ok: true })
  })
})
