// v3 task 16.1 — unit tests for the lock-free experiment-id allocator and
// the slug↔id resolver. Both work against a temp directory rather than
// mocking fs so the EEXIST retry behaviour is realistic.

import { promises as fs } from 'node:fs'
import { mkdtemp } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { nextExperimentId, resolveExperimentId } from './id.js'

describe('nextExperimentId', () => {
  let root: string

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'memon-id-test-'))
  })
  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true })
  })

  it('returns E0001 when docs/experiments/ does not exist', async () => {
    const id = await nextExperimentId(root)
    expect(id).toBe('E0001')
  })

  it('returns E0001 when docs/experiments/ is empty', async () => {
    await fs.mkdir(join(root, 'docs', 'experiments'), { recursive: true })
    const id = await nextExperimentId(root)
    expect(id).toBe('E0001')
  })

  it('returns max+1 across existing exp docs', async () => {
    const dir = join(root, 'docs', 'experiments')
    await fs.mkdir(dir, { recursive: true })
    for (const f of ['E0001-foo.md', 'E0007-bar.md', 'E0003-baz.md']) {
      await fs.writeFile(join(dir, f), '')
    }
    const id = await nextExperimentId(root)
    expect(id).toBe('E0008')
  })

  it('ignores non-canonical filenames', async () => {
    const dir = join(root, 'docs', 'experiments')
    await fs.mkdir(dir, { recursive: true })
    for (const f of ['E0001-foo.md', 'README.md', 'E1.md', 'foo.md', 'E0002.md']) {
      await fs.writeFile(join(dir, f), '')
    }
    const id = await nextExperimentId(root)
    expect(id).toBe('E0002')
  })
})

describe('resolveExperimentId', () => {
  let root: string

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'memon-resolve-test-'))
    const dir = join(root, 'docs', 'experiments')
    await fs.mkdir(dir, { recursive: true })
    for (const f of ['E0001-fsdp-coll.md', 'E0002-attention.md', 'E0003-fsdp-bug.md']) {
      await fs.writeFile(join(dir, f), '')
    }
  })
  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true })
  })

  it('returns the same id when given a full canonical id', async () => {
    expect(await resolveExperimentId(root, 'E0001-fsdp-coll')).toBe('E0001-fsdp-coll')
    expect(await resolveExperimentId(root, 'E0099-missing')).toBeNull()
  })

  it('resolves a unique slug to its full id', async () => {
    expect(await resolveExperimentId(root, 'attention')).toBe('E0002-attention')
  })

  it('returns null when slug is ambiguous', async () => {
    // No exact-slug match for "fsdp" since both fsdp-coll and fsdp-bug exist.
    expect(await resolveExperimentId(root, 'fsdp')).toBeNull()
  })

  it('returns null when nothing matches', async () => {
    expect(await resolveExperimentId(root, 'no-such-thing')).toBeNull()
  })

  it('returns null when docs/experiments/ does not exist', async () => {
    const empty = await mkdtemp(join(tmpdir(), 'memon-resolve-empty-'))
    try {
      expect(await resolveExperimentId(empty, 'E0001-foo')).toBeNull()
    } finally {
      await fs.rm(empty, { recursive: true, force: true })
    }
  })
})
