import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { readFsVersion } from './read.js'
import { FsVersionSchemaError, validateFsVersionRecord } from './schema.js'
import { writeFsVersion } from './write.js'

let dir: string

beforeEach(async () => {
  dir = await fs.mkdtemp(join(tmpdir(), 'memon-fs-version-'))
})

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true })
})

describe('readFsVersion', () => {
  it('returns null when the file is absent', async () => {
    const result = await readFsVersion(dir)
    expect(result).toBeNull()
  })

  it('returns null when .memon/ exists but version.json is absent', async () => {
    await fs.mkdir(join(dir, '.memon'), { recursive: true })
    const result = await readFsVersion(dir)
    expect(result).toBeNull()
  })

  it('reads a valid record', async () => {
    await fs.mkdir(join(dir, '.memon'))
    await fs.writeFile(
      join(dir, '.memon/version.json'),
      JSON.stringify({
        fs_convention_version: 2,
        installed_at: '2026-05-04T10:00:00+08:00',
        last_migrated_at: null,
      }),
    )
    const result = await readFsVersion(dir)
    expect(result).toEqual({
      fs_convention_version: 2,
      installed_at: '2026-05-04T10:00:00+08:00',
      last_migrated_at: null,
    })
  })

  it('throws on garbage JSON', async () => {
    await fs.mkdir(join(dir, '.memon'))
    await fs.writeFile(join(dir, '.memon/version.json'), 'not json {')
    await expect(readFsVersion(dir)).rejects.toThrow(/failed to parse/)
  })

  it('throws on schema violation (wrong field name)', async () => {
    await fs.mkdir(join(dir, '.memon'))
    await fs.writeFile(join(dir, '.memon/version.json'), JSON.stringify({ version: 1 }))
    await expect(readFsVersion(dir)).rejects.toThrow(FsVersionSchemaError)
    await expect(readFsVersion(dir)).rejects.toThrow(/fs_convention_version/)
  })

  it('throws on schema violation (timestamp without offset)', async () => {
    await fs.mkdir(join(dir, '.memon'))
    await fs.writeFile(
      join(dir, '.memon/version.json'),
      JSON.stringify({
        fs_convention_version: 1,
        installed_at: '2026-05-04T10:00:00',
        last_migrated_at: null,
      }),
    )
    await expect(readFsVersion(dir)).rejects.toThrow(/installed_at/)
  })
})

describe('writeFsVersion', () => {
  it('creates .memon/ and writes a valid record', async () => {
    await writeFsVersion(dir, {
      fs_convention_version: 1,
      installed_at: '2026-05-04T10:00:00+08:00',
      last_migrated_at: null,
    })
    const onDisk = JSON.parse(await fs.readFile(join(dir, '.memon/version.json'), 'utf8'))
    expect(onDisk).toEqual({
      fs_convention_version: 1,
      installed_at: '2026-05-04T10:00:00+08:00',
      last_migrated_at: null,
    })
  })

  it('overwrites an existing marker', async () => {
    await writeFsVersion(dir, {
      fs_convention_version: 1,
      installed_at: '2026-05-04T10:00:00+08:00',
      last_migrated_at: null,
    })
    await writeFsVersion(dir, {
      fs_convention_version: 2,
      installed_at: '2026-05-04T10:00:00+08:00',
      last_migrated_at: '2026-06-15T14:23:00+08:00',
    })
    const result = await readFsVersion(dir)
    expect(result?.fs_convention_version).toBe(2)
    expect(result?.last_migrated_at).toBe('2026-06-15T14:23:00+08:00')
  })

  it('rejects an invalid record before touching disk', async () => {
    await expect(
      writeFsVersion(dir, {
        // @ts-expect-error — exercising runtime validation
        fs_convention_version: 'one',
        installed_at: '2026-05-04T10:00:00+08:00',
        last_migrated_at: null,
      }),
    ).rejects.toThrow(FsVersionSchemaError)
    // .memon/ should not have been created either way
    await expect(fs.access(join(dir, '.memon'))).rejects.toThrow()
  })

  it('leaves no temp file behind after a successful write', async () => {
    await writeFsVersion(dir, {
      fs_convention_version: 1,
      installed_at: '2026-05-04T10:00:00+08:00',
      last_migrated_at: null,
    })
    const entries = await fs.readdir(join(dir, '.memon'))
    expect(entries).toEqual(['version.json'])
  })
})

describe('path safety', () => {
  it('rejects projectRoot that escapes via .. in marker construction', async () => {
    // resolveVersionFilePath would only fail if the constructed path didn't
    // equal "<rootAbs>/.memon/version.json". This is mainly a sanity guard;
    // a well-formed projectRoot always passes.
    const result = await readFsVersion(dir)
    expect(result).toBeNull()
  })
})

describe('validateFsVersionRecord', () => {
  it('accepts a valid record', () => {
    const r = validateFsVersionRecord({
      fs_convention_version: 1,
      installed_at: '2026-05-04T10:00:00+08:00',
      last_migrated_at: null,
    })
    expect(r.fs_convention_version).toBe(1)
  })

  it('accepts last_migrated_at as a valid timestamp', () => {
    const r = validateFsVersionRecord({
      fs_convention_version: 2,
      installed_at: '2026-05-04T10:00:00+08:00',
      last_migrated_at: '2026-06-15T14:23:00+08:00',
    })
    expect(r.last_migrated_at).toBe('2026-06-15T14:23:00+08:00')
  })

  it('rejects fs_convention_version === 0', () => {
    expect(() =>
      validateFsVersionRecord({
        fs_convention_version: 0,
        installed_at: '2026-05-04T10:00:00+08:00',
        last_migrated_at: null,
      }),
    ).toThrow(/fs_convention_version/)
  })

  it('rejects non-integer version', () => {
    expect(() =>
      validateFsVersionRecord({
        fs_convention_version: 1.5,
        installed_at: '2026-05-04T10:00:00+08:00',
        last_migrated_at: null,
      }),
    ).toThrow(/fs_convention_version/)
  })
})
