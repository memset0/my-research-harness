import { createHash, randomUUID } from 'node:crypto'
import { promises as nodeFs } from 'node:fs'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import {
  type BackendDistributionManifest,
  DISTRIBUTION_MANIFEST_FILENAME,
  parseBackendDistributionManifest,
  serializeBackendDistributionManifest,
} from './manifest.js'

export interface ReleaseStoreFs {
  mkdir(path: string, options: { recursive?: boolean; mode?: number }): Promise<unknown>
  lstat(path: string): Promise<{
    mode: number
    uid: number
    isDirectory(): boolean
    isFile(): boolean
    isSymbolicLink(): boolean
  }>
  readdir(
    path: string,
    options: { withFileTypes: true },
  ): Promise<
    Array<{ name: string; isDirectory(): boolean; isFile(): boolean; isSymbolicLink(): boolean }>
  >
  writeFile(path: string, data: string, options: { flag: 'wx'; mode: number }): Promise<unknown>
  readFile(path: string, encoding: 'utf8'): Promise<string>
  readFile(path: string): Promise<Buffer>
  rename(from: string, to: string): Promise<unknown>
  chmod(path: string, mode: number): Promise<unknown>
  symlink(target: string, path: string): Promise<unknown>
  readlink(path: string): Promise<string>
  realpath(path: string): Promise<string>
  rm(path: string, options: { recursive: boolean; force: boolean }): Promise<unknown>
}

export interface ReleaseStoreStatusEntry {
  name: string
  manifest: BackendDistributionManifest
}
export interface ReleaseStoreStatus {
  current: ReleaseStoreStatusEntry | null
  previous: ReleaseStoreStatusEntry | null
}

const defaultFs = nodeFs as unknown as ReleaseStoreFs
const CURRENT = 'current'
const PREVIOUS = 'previous'

function enoent(error: unknown): boolean {
  return (error as NodeJS.ErrnoException).code === 'ENOENT'
}
function sameManifest(a: BackendDistributionManifest, b: BackendDistributionManifest): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

export class BackendReleaseStore {
  constructor(
    readonly root: string,
    private readonly fs: ReleaseStoreFs = defaultFs,
    private readonly nonce: () => string = randomUUID,
  ) {}

  releaseName(manifest: BackendDistributionManifest): string {
    const parsed = parseBackendDistributionManifest(manifest)
    return `${parsed.release}-${parsed.revision}`
  }

  async initialize(): Promise<void> {
    try {
      const stat = await this.fs.lstat(this.root)
      if (stat.isSymbolicLink() || !stat.isDirectory())
        throw new Error('release root must be a real directory')
      if ((stat.mode & 0o077) !== 0) throw new Error('release root must be owner-only')
      if (process.getuid && stat.uid !== process.getuid())
        throw new Error('release root must be owned by current user')
    } catch (error) {
      if (!enoent(error)) throw error
      await this.fs.mkdir(this.root, { recursive: true, mode: 0o700 })
    }
  }

  async installFromStaging(
    stagingDir: string,
    manifestInput: BackendDistributionManifest,
  ): Promise<{ outcome: 'installed' | 'already_present'; name: string }> {
    await this.initialize()
    const manifest = parseBackendDistributionManifest(manifestInput)
    const staging = await this.fs.lstat(stagingDir)
    if (staging.isSymbolicLink() || !staging.isDirectory())
      throw new Error('staging must be a real directory')
    await this.assertTreeSafe(stagingDir)
    const computedArtifactSha256 = await computeReleaseTreeSha256(stagingDir, this.fs)
    if (computedArtifactSha256 !== manifest.artifactSha256) {
      throw new Error('staging artifact digest does not match the distribution manifest')
    }
    const name = this.releaseName(manifest)
    const destination = join(this.root, name)
    try {
      const existing = await this.fs.lstat(destination)
      if (existing.isSymbolicLink() || !existing.isDirectory())
        throw new Error('release destination is unsafe')
      const current = await this.readEntry(name)
      if (!sameManifest(current.manifest, manifest))
        throw new Error('existing release content differs')
      return { outcome: 'already_present', name }
    } catch (error) {
      if (!enoent(error)) throw error
    }

    await this.fs.writeFile(
      join(stagingDir, DISTRIBUTION_MANIFEST_FILENAME),
      serializeBackendDistributionManifest(manifest),
      { flag: 'wx', mode: 0o600 },
    )
    await this.fs.rename(stagingDir, destination)
    await this.makeImmutable(destination)
    return { outcome: 'installed', name }
  }

  async activate(name: string): Promise<ReleaseStoreStatus> {
    await this.initialize()
    await this.readEntry(name)
    const current = await this.readPointer(CURRENT)
    if (current === name) return this.status()
    if (current) await this.swapPointer(PREVIOUS, current)
    await this.swapPointer(CURRENT, name)
    return this.status()
  }

  async rollback(): Promise<ReleaseStoreStatus> {
    const previous = await this.readPointer(PREVIOUS)
    if (!previous) throw new Error('no previous release is available')
    return this.activate(previous)
  }

  async status(): Promise<ReleaseStoreStatus> {
    await this.initialize()
    const current = await this.readPointer(CURRENT)
    const previous = await this.readPointer(PREVIOUS)
    return {
      current: current ? await this.readEntry(current) : null,
      previous: previous ? await this.readEntry(previous) : null,
    }
  }

  private async readManifest(directory: string): Promise<BackendDistributionManifest> {
    return parseBackendDistributionManifest(
      JSON.parse(await this.fs.readFile(join(directory, DISTRIBUTION_MANIFEST_FILENAME), 'utf8')),
    )
  }
  private async readEntry(name: string): Promise<ReleaseStoreStatusEntry> {
    if (basename(name) !== name || name === CURRENT || name === PREVIOUS)
      throw new Error('invalid release name')
    const path = join(this.root, name)
    const stat = await this.fs.lstat(path)
    if (stat.isSymbolicLink() || !stat.isDirectory())
      throw new Error('release is not a real directory')
    const manifest = await this.readManifest(path)
    if ((await computeReleaseTreeSha256(path, this.fs)) !== manifest.artifactSha256) {
      throw new Error('installed release artifact digest does not match its manifest')
    }
    return { name, manifest }
  }
  private async readPointer(pointer: string): Promise<string | null> {
    try {
      const path = join(this.root, pointer)
      const stat = await this.fs.lstat(path)
      if (!stat.isSymbolicLink()) throw new Error('release pointer must be a symlink')
      const target = await this.fs.readlink(path)
      if (basename(target) !== target) throw new Error('release pointer target is unsafe')
      await this.readEntry(target)
      return target
    } catch (error) {
      if (enoent(error)) return null
      throw error
    }
  }
  private async swapPointer(pointer: string, target: string): Promise<void> {
    const temporary = join(this.root, `.${pointer}.tmp-${this.nonce()}`)
    await this.fs.symlink(target, temporary)
    try {
      await this.fs.rename(temporary, join(this.root, pointer))
    } catch (error) {
      await this.fs.rm(temporary, { recursive: false, force: true })
      throw error
    }
  }
  private async makeImmutable(path: string): Promise<void> {
    for (const entry of await this.fs.readdir(path, { withFileTypes: true })) {
      const child = join(path, entry.name)
      if (entry.isSymbolicLink()) continue
      if (entry.isDirectory()) {
        await this.makeImmutable(child)
        continue
      }
      if (!entry.isFile()) throw new Error('release contains unsupported filesystem entry')
      const stat = await this.fs.lstat(child)
      await this.fs.chmod(child, (stat.mode & 0o111) !== 0 ? 0o500 : 0o400)
    }
    await this.fs.chmod(path, 0o500)
  }
  private async assertTreeSafe(path: string, root: string = path): Promise<void> {
    for (const entry of await this.fs.readdir(path, { withFileTypes: true })) {
      const child = join(path, entry.name)
      if (entry.isSymbolicLink()) {
        await assertInternalSymlink(root, child, this.fs)
        continue
      }
      if (entry.isDirectory()) await this.assertTreeSafe(child, root)
      else if (!entry.isFile()) throw new Error('release contains unsupported filesystem entry')
    }
  }
}

/** Deterministic digest of release bytes, relative paths, and execute bits. */
export async function computeReleaseTreeSha256(
  root: string,
  fs: ReleaseStoreFs = defaultFs,
): Promise<string> {
  const hash = createHash('sha256')
  const walk = async (directory: string, prefix: string): Promise<void> => {
    const entries = (await fs.readdir(directory, { withFileTypes: true }))
      .filter((entry) => entry.name !== DISTRIBUTION_MANIFEST_FILENAME)
      .sort((a, b) => a.name.localeCompare(b.name))
    for (const entry of entries) {
      const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name
      const path = join(directory, entry.name)
      if (entry.isSymbolicLink()) {
        const target = await assertInternalSymlink(root, path, fs)
        hash.update(`L\0${relativePath}\0${target}\0`)
        continue
      }
      if (entry.isDirectory()) {
        hash.update(`D\0${relativePath}\0`)
        await walk(path, relativePath)
        continue
      }
      if (!entry.isFile()) throw new Error('release contains unsupported filesystem entry')
      const stat = await fs.lstat(path)
      const bytes = await fs.readFile(path)
      const executable = (stat.mode & 0o111) !== 0 ? 1 : 0
      hash.update(`F\0${relativePath}\0${executable}\0${bytes.byteLength}\0`)
      hash.update(bytes)
    }
  }
  await walk(root, '')
  return hash.digest('hex')
}

function isWithin(root: string, target: string): boolean {
  const rel = relative(root, target)
  return rel === '' || (!rel.startsWith(`..${sep}`) && rel !== '..' && !isAbsolute(rel))
}

async function assertInternalSymlink(
  root: string,
  path: string,
  fs: ReleaseStoreFs,
): Promise<string> {
  const target = await fs.readlink(path)
  if (isAbsolute(target) || !isWithin(root, resolve(dirname(path), target))) {
    throw new Error('release symlink target must stay inside the release directory')
  }
  let realTarget: string
  try {
    realTarget = await fs.realpath(path)
  } catch {
    throw new Error('release symlink target must exist')
  }
  if (!isWithin(root, realTarget)) {
    throw new Error('release symlink target must stay inside the release directory')
  }
  const targetStat = await fs.lstat(realTarget)
  if (targetStat.isSymbolicLink() || (!targetStat.isDirectory() && !targetStat.isFile())) {
    throw new Error('release symlink must resolve to a regular file or directory')
  }
  return target
}
