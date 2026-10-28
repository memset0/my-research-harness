import { describe, expect, it } from 'vitest'
import {
  changedByteSpan,
  DocumentTitleError,
  normalizeDocumentTitle,
  setCatalogEntryTitle,
  setManifestTitle,
  setMarkdownTitle,
} from './content-title.js'

describe('normalizeDocumentTitle', () => {
  it('trims and bounds the title', () => {
    expect(normalizeDocumentTitle('  New name ')).toBe('New name')
    for (const bad of ['', '   ', 'a\nb', 'x'.repeat(513), 3])
      expect(() => normalizeDocumentTitle(bad)).toThrow(DocumentTitleError)
  })
})

describe('setManifestTitle', () => {
  it('replaces only the top-level title string', () => {
    const text =
      '{\n  "type": "html",\n  "meta": { "title": "nested" },\n  "title": "Old \\"name\\"",\n  "description": "d"\n}\n'
    const next = setManifestTitle(text, '新的 "标题"')
    expect(next).toBe(
      '{\n  "type": "html",\n  "meta": { "title": "nested" },\n  "title": "新的 \\"标题\\"",\n  "description": "d"\n}\n',
    )
    expect(JSON.parse(next).title).toBe('新的 "标题"')
  })

  it('refuses a manifest without a title string', () => {
    expect(() => setManifestTitle('{"type":"html"}', 'x')).toThrow(DocumentTitleError)
    expect(() => setManifestTitle('{', 'x')).toThrow(DocumentTitleError)
  })
})

describe('setMarkdownTitle', () => {
  it('rewrites only the frontmatter title value', () => {
    const text = '---\nid: W0001\ntitle: Old  # note\nkind: guide\n---\n# Heading\nBody\n'
    expect(setMarkdownTitle(text, 'New: name')).toBe(
      '---\nid: W0001\ntitle: "New: name"  # note\nkind: guide\n---\n# Heading\nBody\n',
    )
  })

  it('adds a missing frontmatter title as the last key', () => {
    expect(setMarkdownTitle('---\nid: R0001\n---\nBody\n', 'T')).toBe(
      '---\nid: R0001\ntitle: "T"\n---\nBody\n',
    )
  })

  it('renames the first H1 outside code fences without frontmatter', () => {
    const text = '```\n# not this\n```\n\n# Old\r\nBody\n'
    expect(setMarkdownTitle(text, 'New')).toBe('```\n# not this\n```\n\n# New\r\nBody\n')
  })

  it('prepends frontmatter when there is no H1', () => {
    expect(setMarkdownTitle('Body only\n', 'T')).toBe('---\ntitle: "T"\n---\nBody only\n')
  })
})

describe('setCatalogEntryTitle', () => {
  it('changes one entry title and mtime in the writer layout', () => {
    const catalog = {
      catalog_version: 1,
      kind: 'reports',
      generated_at: '2026-10-28T10:00:00+08:00',
      entries: [
        { id: 'R0002', slug: 'b', resource: 'r2', summary: { id: 'R0002', title: 'B', mtime: 1 } },
        { id: 'R0001', slug: 'a', resource: 'r1', summary: { id: 'R0001', title: 'A', mtime: 1 } },
      ],
    }
    const text = `${JSON.stringify(catalog, null, 2)}\n`
    const next = setCatalogEntryTitle(text, 'R0001', { title: 'New', mtime: 2 })
    const parsed = JSON.parse(next)
    expect(parsed.entries[1].summary).toEqual({ id: 'R0001', title: 'New', mtime: 2 })
    expect(parsed.entries[0].summary.title).toBe('B')
    expect(changedByteSpan(text, next)).toBeLessThan(40)
    expect(() => setCatalogEntryTitle(text, 'R0009', { title: 'x' })).toThrow(DocumentTitleError)
  })
})

describe('changedByteSpan', () => {
  it('measures UTF-8 bytes outside the common prefix and suffix', () => {
    expect(changedByteSpan('title: a\n', 'title: 标题\n')).toBe(6)
    expect(changedByteSpan('same', 'same')).toBe(0)
  })
})
