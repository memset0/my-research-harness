// Unit tests for the lock-free experiment-id allocator and the
// slug↔id resolver. Both work against a temp directory rather than
// mocking fs so EEXIST retry behaviour is realistic.
//
// Post-v5 the experiment lives at `E<NNNN>-<slug>/README.md`. Legacy
// v4 `E<NNNN>-<slug>.md` files are still accepted during the
// migration window — both forms feed the same allocator/resolver and
// have explicit coverage here.

import { promises as fs } from 'node:fs'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { nextExperimentId, resolveExperimentId } from './id.js'

async function seedExpFolder(dir: string, id: string): Promise<void> {
  await fs.mkdir(join(dir, id), { recursive: true })
  await fs.writeFile(join(dir, id, 'README.md'), '')
}

async function seedLegacyExpFile(dir: string, idWithMd: string): Promise<void> {
  await fs.writeFile(join(dir, idWithMd), '')
}

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

  it('returns max+1 across existing v5 exp folders', async () => {
    const dir = join(root, 'docs', 'experiments')
    await fs.mkdir(dir, { recursive: true })
    for (const id of ['E0001-foo', 'E0007-bar', 'E0003-baz']) {
      await seedExpFolder(dir, id)
    }
    const id = await nextExperimentId(root)
    expect(id).toBe('E0008')
  })

  it('ignores non-canonical entries', async () => {
    const dir = join(root, 'docs', 'experiments')
    await fs.mkdir(dir, { recursive: true })
    await seedExpFolder(dir, 'E0001-foo')
    // Junk that should NOT count toward NNNN:
    await fs.writeFile(join(dir, 'README.md'), '')
    await fs.mkdir(join(dir, 'E1'), { recursive: true })
    await fs.writeFile(join(dir, 'foo.md'), '')
    await fs.mkdir(join(dir, 'E0002'), { recursive: true })
    const id = await nextExperimentId(root)
    expect(id).toBe('E0002')
  })

  it('counts both v5 folders and legacy v4 .md files toward max', async () => {
    const dir = join(root, 'docs', 'experiments')
    await fs.mkdir(dir, { recursive: true })
    await seedExpFolder(dir, 'E0001-foo')
    await seedLegacyExpFile(dir, 'E0002-legacy.md')
    await seedExpFolder(dir, 'E0007-baz')
    const id = await nextExperimentId(root)
    expect(id).toBe('E0008')
  })
})

describe('resolveExperimentId', () => {
  let root: string

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'memon-resolve-test-'))
    const dir = join(root, 'docs', 'experiments')
    await fs.mkdir(dir, { recursive: true })
    for (const id of ['E0001-fsdp-coll', 'E0002-attention', 'E0003-fsdp-bug']) {
      await seedExpFolder(dir, id)
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

  it('resolves a slug from a legacy v4 .md file during migration', async () => {
    const empty = await mkdtemp(join(tmpdir(), 'memon-resolve-legacy-'))
    try {
      const dir = join(empty, 'docs', 'experiments')
      await fs.mkdir(dir, { recursive: true })
      await seedExpFolder(dir, 'E0001-foo')
      await seedLegacyExpFile(dir, 'E0002-legacy.md')
      expect(await resolveExperimentId(empty, 'legacy')).toBe('E0002-legacy')
      expect(await resolveExperimentId(empty, 'E0002-legacy')).toBe('E0002-legacy')
      expect(await resolveExperimentId(empty, 'foo')).toBe('E0001-foo')
    } finally {
      await fs.rm(empty, { recursive: true, force: true })
    }
  })
})
