// @vitest-environment node
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  canonicalLandingPath,
  matchShare,
  publicDocuments,
  ShareRegistryInputError,
  type ShareRegistryRecord,
  shareLandingPath,
  shareRegistryFor,
} from './share-registry'

let directory: string
const registry = () => shareRegistryFor(join(directory, 'config.yml'))

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'memon-share-registry-'))
})
afterEach(async () => {
  await rm(directory, { recursive: true, force: true })
})

describe('share registry', () => {
  it('issues document and Project tokens beside the config with owner-only permissions', async () => {
    const page = await registry().create({
      host: 'host-a',
      project: 'project-x',
      scope: { kind: 'wiki', id: 'W0004' },
      label: 'Alice',
    })
    const whole = await registry().create({
      host: 'host-a',
      project: 'project-x',
      scope: { kind: 'project' },
      currentPath: '/host-a/project-x/reports?x=1',
      expires: '7d',
    })

    expect(page.path).toBe('/host-a/project-x/w/4')
    expect(whole.path).toBe('/host-a/project-x/reports?x=1')
    expect(whole.expires_at).not.toBeNull()
    const file = join(directory, 'shares.json')
    expect((await stat(file)).mode & 0o777).toBe(0o600)
    expect(JSON.parse(await readFile(file, 'utf8')).shares).toHaveLength(2)

    expect(await registry().validate('host-a', 'project-x', page.token)).toEqual({
      scope: { kind: 'wiki', id: 'W0004' },
      service: false,
    })
    expect(await registry().validate('host-b', 'project-x', page.token)).toBeNull()
    expect(await registry().validate('host-a', 'project-x', 'x'.repeat(24))).toBeNull()
    expect(await registry().list({ host: 'host-a', project: 'project-x' })).toHaveLength(2)
    expect(await registry().list({ project: 'other' })).toHaveLength(0)
  })

  it('revokes by id and ignores expired tokens', async () => {
    const record = await registry().create({
      host: 'host-a',
      project: 'project-x',
      scope: { kind: 'report', id: 'R0005' },
    })
    expect(record.path).toBe('/host-a/project-x/r/5')
    expect(await registry().remove('shr_missing0')).toBe(false)
    expect(await registry().remove(record.id)).toBe(true)
    expect(await registry().validate('host-a', 'project-x', record.token)).toBeNull()

    const short = await registry().create(
      { host: 'host-a', project: 'project-x', scope: { kind: 'project' }, expires: '1h' },
      new Date(Date.now() - 2 * 60 * 60 * 1000),
    )
    expect(await registry().find(short.token)).toBeNull()
  })

  it('rejects invalid scopes, labels and expiries', async () => {
    const base = { host: 'host-a', project: 'project-x' }
    await expect(
      registry().create({ ...base, scope: { kind: 'wiki', id: 'R0001' } }),
    ).rejects.toBeInstanceOf(ShareRegistryInputError)
    await expect(
      registry().create({ ...base, scope: { kind: 'project' }, label: 'x'.repeat(65) }),
    ).rejects.toBeInstanceOf(ShareRegistryInputError)
    await expect(
      registry().create({ ...base, scope: { kind: 'project' }, expires: 'soon' }),
    ).rejects.toBeInstanceOf(ShareRegistryInputError)
  })

  it('fails closed when the registry cannot be parsed', async () => {
    await writeFile(join(directory, 'shares.json'), '{"version":1,"shares":[{"id":1}]}')
    await expect(registry().validate('host-a', 'project-x', 'a'.repeat(24))).rejects.toThrow()
  })
})

describe('public pages', () => {
  it('marks Report and Wiki pages public once and never redeems their token', async () => {
    const input = {
      host: 'host-a',
      project: 'project-x',
      scope: { kind: 'report' as const, id: 'R0005' },
      public: true,
    }
    const first = await registry().create(input)
    const again = await registry().create(input)
    expect(again.id).toBe(first.id)
    expect(first.public).toBe(true)
    const records = await registry().read()
    expect(records).toHaveLength(1)
    expect(publicDocuments(records, 'host-a', 'project-x')).toEqual([
      { kind: 'report', id: 'R0005' },
    ])
    expect(publicDocuments(records, 'host-b', 'project-x')).toEqual([])
    expect(matchShare(records, 'host-a', 'project-x', first.token)).toBeNull()
    expect(await registry().find(first.token)).toBeNull()
    await expect(
      registry().create({ ...input, scope: { kind: 'experiment', id: 'E0001-x' } }),
    ).rejects.toBeInstanceOf(ShareRegistryInputError)
    await expect(
      registry().create({ ...input, scope: { kind: 'project' } }),
    ).rejects.toBeInstanceOf(ShareRegistryInputError)
    expect(await registry().remove(first.id)).toBe(true)
    expect(publicDocuments(await registry().read(), 'host-a', 'project-x')).toEqual([])
  })
})

describe('service links', () => {
  it('issues a service token for a Report or Wiki page only, never public', async () => {
    const input = {
      host: 'host-a',
      project: 'project-x',
      scope: { kind: 'report' as const, id: 'R0010' },
      service: true,
    }
    const record = await registry().create(input)
    expect(record).toMatchObject({ service: true, path: '/host-a/project-x/r/10' })
    expect(matchShare(await registry().read(), 'host-a', 'project-x', record.token)).toEqual({
      scope: { kind: 'report', id: 'R0010' },
      service: true,
    })
    for (const bad of [
      { ...input, public: true },
      { ...input, scope: { kind: 'project' as const } },
      { ...input, scope: { kind: 'experiment' as const, id: 'E0001-x' } },
    ])
      await expect(registry().create(bad)).rejects.toBeInstanceOf(ShareRegistryInputError)
  })
})

describe('landing paths', () => {
  const scope = { kind: 'project' } as const
  it('keeps a Project share inside the Project route', () => {
    expect(
      shareLandingPath('host-a', 'project-x', scope, '/host-a/project-x/e/1?run=r-1#top'),
    ).toBe('/host-a/project-x/e/1?run=r-1')
    for (const outside of [
      '/host-a/project-y/wiki',
      '/host-a/project-xy',
      '/host-b/project-x',
      'https://evil.example/host-a/project-x',
      '/host-a/project-x/../project-y',
      '/host-a/project-x/%2e%2e/project-y',
      '/host-a/project-x//evil.example',
      '/h/host-a/p/project-x/e/E0001-x',
    ])
      expect(shareLandingPath('host-a', 'project-x', scope, outside)).toBe('/host-a/project-x')
    expect(shareLandingPath('host-a', 'project-x', { kind: 'experiment', id: 'E0001-x' })).toBe(
      '/host-a/project-x/e/1',
    )
  })

  it('maps stored older landing paths to canonical pages without rewriting them', () => {
    const record = (path: string, scopeValue: ShareRegistryRecord['scope'] = scope) =>
      ({
        id: 'shr_abcdefgh',
        token: 'A'.repeat(24),
        host: 'host-a',
        project: 'project-x',
        scope: scopeValue,
        path,
        created_at: '2026-10-01T00:00:00+08:00',
        expires_at: null,
      }) satisfies ShareRegistryRecord
    expect(canonicalLandingPath(record('/h/host-a/p/project-x/reports/R0005?expanded=1'))).toBe(
      '/host-a/project-x/r/5?expanded=1',
    )
    expect(canonicalLandingPath(record('/h/host-a/p/project-x'))).toBe('/host-a/project-x')
    expect(canonicalLandingPath(record('/h/host-a/p/project-x/unknown'))).toBe('/host-a/project-x')
    expect(canonicalLandingPath(record('/h/host-b/p/project-x/wiki'))).toBe('/host-a/project-x')
    expect(
      canonicalLandingPath(
        record('/h/host-a/p/project-x/e/E0001-x', { kind: 'experiment', id: 'E0001-x' }),
      ),
    ).toBe('/host-a/project-x/e/1')
    expect(canonicalLandingPath({ ...record('/p/project-x'), host: null })).toBeNull()
  })
})
