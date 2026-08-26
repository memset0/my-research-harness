import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { type BackendDistributionManifest, parseBackendDistributionManifest } from './manifest.js'
import { BackendReleaseStore, computeReleaseTreeSha256 } from './release-store.js'

let dir: string
beforeEach(async () => {
  dir = await fs.mkdtemp(join(tmpdir(), 'memon-releases-'))
})

async function makeFixtureTreeRemovable(path: string): Promise<void> {
  const stat = await fs.lstat(path).catch(() => null)
  if (!stat?.isDirectory() || stat.isSymbolicLink()) return
  await fs.chmod(path, 0o700)
  for (const child of await fs.readdir(path)) {
    await makeFixtureTreeRemovable(join(path, child))
  }
}

afterEach(async () => {
  await makeFixtureTreeRemovable(dir)
  await fs.rm(dir, { recursive: true, force: true })
})

function manifest(release = '6.1.0', revision = 'revision-a'): BackendDistributionManifest {
  return {
    version: 1,
    release,
    revision,
    artifactSha256: 'a'.repeat(64),
    platform: process.platform,
    arch: process.arch,
    nodeRange: '>=20.19 <23',
    createdAt: '2026-08-26T17:00:00.000Z',
  }
}

async function staging(name: string): Promise<string> {
  const path = join(dir, name)
  await fs.mkdir(join(path, 'bin'), { recursive: true })
  await fs.writeFile(join(path, 'bin', 'backend.js'), 'built bytes', { mode: 0o755 })
  return path
}

async function stagedRelease(
  name: string,
  release = '6.1.0',
  revision = 'revision-a',
): Promise<{ path: string; manifest: BackendDistributionManifest }> {
  const path = await staging(name)
  return {
    path,
    manifest: {
      ...manifest(release, revision),
      artifactSha256: await computeReleaseTreeSha256(path),
    },
  }
}

describe('Backend distribution manifest', () => {
  it('strictly validates release Major, revision, digest, platform, and Node range', () => {
    expect(parseBackendDistributionManifest(manifest())).toMatchObject({
      platform: process.platform,
      arch: process.arch,
    })
    for (const invalid of [
      { ...manifest(), release: '7.1.0' },
      { ...manifest(), revision: '../bad' },
      { ...manifest(), artifactSha256: 'ABC' },
      { ...manifest(), nodeRange: 'latest' },
      { ...manifest(), extra: true },
    ])
      expect(() => parseBackendDistributionManifest(invalid)).toThrow()
  })
})

describe('immutable Backend release store', () => {
  it('renames staging into an immutable release and keeps matching reinstall idempotent', async () => {
    const root = join(dir, 'store')
    const store = new BackendReleaseStore(root)
    const source = await stagedRelease('stage-a')
    await expect(store.installFromStaging(source.path, source.manifest)).resolves.toEqual({
      outcome: 'installed',
      name: '6.1.0-revision-a',
    })
    await expect(fs.access(source.path)).rejects.toThrow()
    const releaseDir = join(root, '6.1.0-revision-a')
    expect((await fs.stat(join(releaseDir, 'memon-backend-manifest.json'))).mode & 0o777).toBe(
      0o400,
    )
    expect((await fs.stat(join(releaseDir, 'bin', 'backend.js'))).mode & 0o777).toBe(0o500)

    const second = await stagedRelease('stage-same')
    await expect(store.installFromStaging(second.path, second.manifest)).resolves.toMatchObject({
      outcome: 'already_present',
    })
    expect(await fs.readFile(join(releaseDir, 'bin', 'backend.js'), 'utf8')).toBe('built bytes')
  })

  it('rejects mismatched existing content and directory symlinks', async () => {
    const root = join(dir, 'store')
    const store = new BackendReleaseStore(root)
    const first = await stagedRelease('stage-a')
    await store.installFromStaging(first.path, first.manifest)
    const mismatch = await stagedRelease('stage-b')
    await fs.writeFile(join(mismatch.path, 'bin', 'backend.js'), 'different bytes', { mode: 0o755 })
    mismatch.manifest.artifactSha256 = await computeReleaseTreeSha256(mismatch.path)
    await expect(store.installFromStaging(mismatch.path, mismatch.manifest)).rejects.toThrow(
      /differs/,
    )

    const linked = await staging('stage-link')
    await fs.symlink('/tmp', join(linked, 'linked-dir'))
    await expect(store.installFromStaging(linked, manifest('6.2.0', 'revision-b'))).rejects.toThrow(
      /symlink/,
    )
  })

  it('preserves relative internal dependency links but rejects broken or escaping links', async () => {
    const store = new BackendReleaseStore(join(dir, 'store-links'))
    const source = await staging('stage-internal-link')
    await fs.symlink('bin/backend.js', join(source, 'backend'))
    const sourceManifest = manifest('6.2.0', 'revision-links')
    sourceManifest.artifactSha256 = await computeReleaseTreeSha256(source)
    await store.installFromStaging(source, sourceManifest)
    const release = join(store.root, '6.2.0-revision-links')
    expect(await fs.readlink(join(release, 'backend'))).toBe('bin/backend.js')
    expect(await fs.readFile(join(release, 'backend'), 'utf8')).toBe('built bytes')

    const broken = await staging('stage-broken-link')
    await fs.symlink('missing.js', join(broken, 'missing'))
    await expect(computeReleaseTreeSha256(broken)).rejects.toThrow(/must exist/)

    const escaping = await staging('stage-escaping-link')
    await fs.symlink('../../outside', join(escaping, 'outside'))
    await expect(computeReleaseTreeSha256(escaping)).rejects.toThrow(/stay inside/)
  })

  it('atomically tracks current/previous and swaps them on rollback', async () => {
    const root = join(dir, 'store')
    const store = new BackendReleaseStore(
      root,
      undefined,
      (() => {
        let n = 0
        return () => String(++n)
      })(),
    )
    const first = await stagedRelease('stage-a', '6.1.0', 'revision-a')
    const second = await stagedRelease('stage-b', '6.2.0', 'revision-b')
    await store.installFromStaging(first.path, first.manifest)
    await store.installFromStaging(second.path, second.manifest)
    await store.activate('6.1.0-revision-a')
    let status = await store.activate('6.2.0-revision-b')
    expect(status.current?.name).toBe('6.2.0-revision-b')
    expect(status.previous?.name).toBe('6.1.0-revision-a')
    status = await store.rollback()
    expect(status.current?.name).toBe('6.1.0-revision-a')
    expect(status.previous?.name).toBe('6.2.0-revision-b')
  })

  it('never overwrites bytes of the running immutable release during install or activation', async () => {
    const root = join(dir, 'store-bytes')
    const store = new BackendReleaseStore(root)
    const old = await stagedRelease('stage-old', '6.1.0', 'revision-old')
    await store.installFromStaging(old.path, old.manifest)
    await store.activate('6.1.0-revision-old')
    const oldFile = join(root, '6.1.0-revision-old', 'bin', 'backend.js')
    const before = await fs.stat(oldFile)
    const nextStage = await staging('stage-new')
    await fs.writeFile(join(nextStage, 'bin', 'backend.js'), 'new bytes')
    const nextManifest = { ...manifest('6.2.0', 'revision-new') }
    nextManifest.artifactSha256 = await computeReleaseTreeSha256(nextStage)
    await store.installFromStaging(nextStage, nextManifest)
    await store.activate('6.2.0-revision-new')
    const after = await fs.stat(oldFile)
    expect(after.ino).toBe(before.ino)
    expect(await fs.readFile(oldFile, 'utf8')).toBe('built bytes')
    expect((await store.status()).previous?.name).toBe('6.1.0-revision-old')
  })

  it('rejects a group-readable or symlinked release root', async () => {
    const root = join(dir, 'unsafe')
    await fs.mkdir(root, { mode: 0o755 })
    await expect(new BackendReleaseStore(root).initialize()).rejects.toThrow(/owner-only/)
    await fs.rm(root, { recursive: true })
    await fs.symlink(dir, root)
    await expect(new BackendReleaseStore(root).initialize()).rejects.toThrow(/real directory/)
  })

  it('rejects staging bytes that do not match the declared artifact digest', async () => {
    const source = await staging('stage-digest-mismatch')
    await expect(
      new BackendReleaseStore(join(dir, 'store')).installFromStaging(source, manifest()),
    ).rejects.toThrow(/digest/)
  })

  it('refuses to report or activate installed bytes changed after verification', async () => {
    const root = join(dir, 'store-tampered')
    const store = new BackendReleaseStore(root)
    const source = await stagedRelease('stage-tampered')
    await store.installFromStaging(source.path, source.manifest)
    const release = join(root, '6.1.0-revision-a')
    const entry = join(release, 'bin', 'backend.js')
    await fs.chmod(release, 0o700)
    await fs.chmod(join(release, 'bin'), 0o700)
    await fs.chmod(entry, 0o600)
    await fs.writeFile(entry, 'tampered bytes')
    await expect(store.activate('6.1.0-revision-a')).rejects.toThrow(/digest/)
  })
})
