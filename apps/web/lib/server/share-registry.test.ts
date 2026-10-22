// @vitest-environment node
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  matchShare,
  publicDocuments,
  ShareRegistryInputError,
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
      currentPath: '/h/host-a/p/project-x/reports',
      expires: '7d',
    })

    expect(page.path).toBe('/h/host-a/p/project-x/wiki/W0004')
    expect(whole.path).toBe('/h/host-a/p/project-x/reports')
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
      host: null,
      project: 'project-x',
      scope: { kind: 'report', id: 'R0005' },
    })
    expect(record.path).toBe('/p/project-x/reports/R0005')
    expect(await registry().remove('shr_missing0')).toBe(false)
    expect(await registry().remove(record.id)).toBe(true)
    expect(await registry().validate(null, 'project-x', record.token)).toBeNull()

    const short = await registry().create(
      { host: null, project: 'project-x', scope: { kind: 'project' }, expires: '1h' },
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
    expect(record).toMatchObject({ service: true, path: '/h/host-a/p/project-x/reports/R0010' })
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
    expect(shareLandingPath('host-a', 'project-x', scope, '/h/host-a/p/project-x/e/E0001-x')).toBe(
      '/h/host-a/p/project-x/e/E0001-x',
    )
    for (const outside of [
      '/h/host-a/p/project-y/wiki',
      '/h/host-a/p/project-xy',
      'https://evil.example/h/host-a/p/project-x',
      '/h/host-a/p/project-x/../project-y',
      '/h/host-a/p/project-x/%2e%2e/project-y',
      '/h/host-a/p/project-x//evil.example',
    ])
      expect(shareLandingPath('host-a', 'project-x', scope, outside)).toBe('/h/host-a/p/project-x')
    expect(shareLandingPath('host-a', 'project-x', { kind: 'experiment', id: 'E0001-x' })).toBe(
      '/h/host-a/p/project-x/e/E0001-x',
    )
  })
})
