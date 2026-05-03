import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { LineIndex } from './line-index.js'

let dir: string

beforeEach(async () => {
  dir = await fs.mkdtemp(join(tmpdir(), 'memon-lineindex-'))
})

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true })
})

async function writeFile(name: string, content: string): Promise<string> {
  const p = join(dir, name)
  await fs.writeFile(p, content)
  return p
}

describe('LineIndex.build', () => {
  it('handles empty file', async () => {
    const path = await writeFile('empty.log', '')
    const idx = await LineIndex.build(path)
    expect(idx.totalLines).toBe(0)
  })

  it('handles single line without trailing newline', async () => {
    const path = await writeFile('one.log', 'hello')
    const idx = await LineIndex.build(path)
    expect(idx.totalLines).toBe(1)
    const r = await idx.range(1, 1)
    expect(r).toEqual([{ lineNumber: 1, text: 'hello' }])
  })

  it('handles single line with trailing newline', async () => {
    const path = await writeFile('one-nl.log', 'hello\n')
    const idx = await LineIndex.build(path)
    expect(idx.totalLines).toBe(1)
    const r = await idx.range(1, 1)
    expect(r).toEqual([{ lineNumber: 1, text: 'hello' }])
  })

  it('handles multi-line file with trailing newline', async () => {
    const path = await writeFile('multi.log', 'a\nb\nc\n')
    const idx = await LineIndex.build(path)
    expect(idx.totalLines).toBe(3)
    expect(await idx.range(3, 3)).toEqual([
      { lineNumber: 1, text: 'a' },
      { lineNumber: 2, text: 'b' },
      { lineNumber: 3, text: 'c' },
    ])
  })

  it('handles multi-line file without trailing newline', async () => {
    const path = await writeFile('multi-no-nl.log', 'a\nb\nc')
    const idx = await LineIndex.build(path)
    expect(idx.totalLines).toBe(3)
    expect(await idx.range(3, 3)).toEqual([
      { lineNumber: 1, text: 'a' },
      { lineNumber: 2, text: 'b' },
      { lineNumber: 3, text: 'c' },
    ])
  })
})

describe('LineIndex.range', () => {
  async function build(content: string) {
    const path = await writeFile('r.log', content)
    return LineIndex.build(path, { anchorEvery: 4 })
  }

  it('returns the last 100 lines (clamped)', async () => {
    const lines = Array.from({ length: 50 }, (_, i) => `line ${i + 1}`).join('\n') + '\n'
    const idx = await build(lines)
    const r = await idx.range(idx.totalLines, 100)
    expect(r).toHaveLength(50)
    expect(r[0]).toEqual({ lineNumber: 1, text: 'line 1' })
    expect(r[r.length - 1]).toEqual({ lineNumber: 50, text: 'line 50' })
  })

  it('returns last N lines for a 1k-line file', async () => {
    const total = 1000
    const content = Array.from({ length: total }, (_, i) => `L${i + 1}`).join('\n') + '\n'
    const idx = await build(content)
    expect(idx.totalLines).toBe(total)
    const r = await idx.range(total, 100)
    expect(r).toHaveLength(100)
    expect(r[0]).toEqual({ lineNumber: 901, text: 'L901' })
    expect(r[99]).toEqual({ lineNumber: 1000, text: 'L1000' })
  })

  it('returns mid-range slice', async () => {
    const content = Array.from({ length: 50 }, (_, i) => `n${i + 1}`).join('\n') + '\n'
    const idx = await build(content)
    const r = await idx.range(20, 5)
    expect(r.map((l) => l.lineNumber)).toEqual([16, 17, 18, 19, 20])
    expect(r[0]!.text).toBe('n16')
    expect(r[4]!.text).toBe('n20')
  })

  it('clamps endLine past file end', async () => {
    const content = 'a\nb\nc\n'
    const idx = await build(content)
    const r = await idx.range(999, 100)
    expect(r.map((l) => l.lineNumber)).toEqual([1, 2, 3])
  })

  it('returns empty for count <= 0', async () => {
    const idx = await build('a\nb\n')
    expect(await idx.range(2, 0)).toEqual([])
  })
})

describe('LineIndex.appendDelta', () => {
  it('detects appended lines and extends the index', async () => {
    const path = await writeFile('a.log', 'one\ntwo\n')
    const idx = await LineIndex.build(path, { anchorEvery: 4 })
    expect(idx.totalLines).toBe(2)

    await fs.appendFile(path, 'three\nfour\nfive\n')
    const result = await idx.appendDelta()
    expect(result.rotated).toBe(false)
    expect(result.added).toBe(3)
    expect(idx.totalLines).toBe(5)
    expect(await idx.range(5, 5)).toEqual([
      { lineNumber: 1, text: 'one' },
      { lineNumber: 2, text: 'two' },
      { lineNumber: 3, text: 'three' },
      { lineNumber: 4, text: 'four' },
      { lineNumber: 5, text: 'five' },
    ])
  })

  it('handles append when previous content lacked trailing newline', async () => {
    const path = await writeFile('b.log', 'partial')
    const idx = await LineIndex.build(path)
    expect(idx.totalLines).toBe(1)
    await fs.appendFile(path, '-tail\nnext\n')
    const r = await idx.appendDelta()
    expect(r.added).toBe(1)
    expect(idx.totalLines).toBe(2)
    expect(await idx.range(2, 2)).toEqual([
      { lineNumber: 1, text: 'partial-tail' },
      { lineNumber: 2, text: 'next' },
    ])
  })

  it('flags rotation when file size shrinks', async () => {
    const path = await writeFile('c.log', 'old long content\nmore\nlines\n')
    const idx = await LineIndex.build(path)
    await fs.writeFile(path, 'short\n')
    const r = await idx.appendDelta()
    expect(r.rotated).toBe(true)
    expect(r.added).toBe(0)
  })

  it('flags rotation when inode changes (replace file)', async () => {
    const path = await writeFile('d.log', 'a\nb\nc\n')
    const idx = await LineIndex.build(path)
    // Overwrite via rename — same path, new inode
    const newPath = await writeFile('d.new.log', 'a\nb\nc\nd\ne\nf\n')
    await fs.rename(newPath, path)
    const r = await idx.appendDelta()
    expect(r.rotated).toBe(true)
  })
})

describe('LineIndex on large files', () => {
  it('queries last 100 lines of a 50k-line file accurately', async () => {
    const total = 50_000
    const content = Array.from({ length: total }, (_, i) => `LINE_${i + 1}`).join('\n') + '\n'
    const path = await writeFile('big.log', content)
    const idx = await LineIndex.build(path)
    expect(idx.totalLines).toBe(total)
    const r = await idx.range(total, 100)
    expect(r).toHaveLength(100)
    expect(r[0]).toEqual({ lineNumber: total - 99, text: `LINE_${total - 99}` })
    expect(r[99]).toEqual({ lineNumber: total, text: `LINE_${total}` })
  })
})
