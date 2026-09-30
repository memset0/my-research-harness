import { describe, expect, it } from 'vitest'

import { parseWikiFrontmatter, serializeWikiPage, updateWikiFrontmatter } from './frontmatter.js'

const PAGE = `---
id: W0004
kind: note
title: Alpha
owner: alice
created_at: "2026-05-05T09:00:00+08:00"
updated_at: "2026-05-06T14:20:00+08:00"
---

# Alpha

Body with a  trailing   space run and a fence:

\`\`\`python
print("---")
\`\`\`
`

describe('parseWikiFrontmatter', () => {
  it('splits known and unknown keys from a verbatim body', () => {
    const parsed = parseWikiFrontmatter(PAGE)
    expect(parsed.frontmatter?.id).toBe('W0004')
    expect(parsed.frontmatter?.owner).toBe('alice')
    // ISO8601 offsets survive as strings — never coerced into Date.
    expect(parsed.frontmatter?.created_at).toBe('2026-05-05T09:00:00+08:00')
    // The blank line after the closing delimiter belongs to the body.
    expect(parsed.body).toBe(PAGE.slice(PAGE.indexOf('\n# Alpha')))
  })

  it('returns the whole file as body when there is no frontmatter', () => {
    const parsed = parseWikiFrontmatter('# No frontmatter\n')
    expect(parsed.frontmatter).toBeNull()
    expect(parsed.body).toBe('# No frontmatter\n')
  })

  it('reports broken YAML instead of throwing', () => {
    const parsed = parseWikiFrontmatter('---\nid: [W0001\n---\nbody\n')
    expect(parsed.frontmatter).toBeNull()
    expect(parsed.error).toBeTruthy()
    expect(parsed.body).toBe('body\n')
  })

  it('rejects a non-mapping frontmatter block', () => {
    const parsed = parseWikiFrontmatter('---\n- one\n- two\n---\nbody\n')
    expect(parsed.frontmatter).toBeNull()
    expect(parsed.error).toContain('mapping')
  })
})

describe('serializeWikiPage', () => {
  it('round-trips unknown keys, key order, and the body byte-for-byte', () => {
    const parsed = parseWikiFrontmatter(PAGE)
    const written = serializeWikiPage(parsed.frontmatter!, parsed.body)
    const reparsed = parseWikiFrontmatter(written)

    expect(reparsed.body).toBe(parsed.body)
    expect(Object.keys(reparsed.frontmatter!)).toEqual([
      'id',
      'kind',
      'title',
      'owner',
      'created_at',
      'updated_at',
    ])
    expect(reparsed.frontmatter).toEqual(parsed.frontmatter)
    // Second write is byte-identical: serialization is a fixed point.
    expect(serializeWikiPage(reparsed.frontmatter!, reparsed.body)).toBe(written)
  })
})

describe('updateWikiFrontmatter', () => {
  it('edits in place, appends new keys, and drops undefined ones', () => {
    const parsed = parseWikiFrontmatter(PAGE)
    const next = updateWikiFrontmatter(parsed.frontmatter!, {
      title: 'Beta',
      status: 'OPEN',
      owner: undefined,
    })
    expect(Object.keys(next)).toEqual(['id', 'kind', 'title', 'created_at', 'updated_at', 'status'])
    expect(next.title).toBe('Beta')
  })
})
