import { execFile as nodeExecFile } from 'node:child_process'
import { promises as fs } from 'node:fs'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { promisify } from 'node:util'
import { MEMON_RELEASE } from '@memon/core'
import type { BackendDistributionManifest } from '../distribution/manifest.js'
import {
  type BackendReleaseStore,
  computeReleaseTreeSha256,
} from '../distribution/release-store.js'

const execFilePromise = promisify(nodeExecFile)
export const EXACT_REVISION_PATTERN = /^[a-f0-9]{40}$/

export interface BuildCommand {
  command: string
  args: readonly string[]
}
export const DEFAULT_BACKEND_BUILD_COMMANDS: readonly BuildCommand[] = [
  { command: 'pnpm', args: ['install', '--frozen-lockfile'] },
  ...['core', 'backend', 'cli'].flatMap((name) => [
    { command: 'pnpm', args: ['--filter', `@memon/${name}`, 'build'] },
    { command: 'pnpm', args: ['--filter', `@memon/${name}`, 'test'] },
  ]),
]

export type UpdateExec = (
  command: string,
  args: readonly string[],
  options: { cwd: string },
) => Promise<{ stdout: string; stderr: string }>
export interface PrepareBackendReleaseOptions {
  checkoutDir: string
  stagingDir: string
  targetRevision: string
  releaseStore: BackendReleaseStore
  release?: string
  nodeRange?: string
  commands?: readonly BuildCommand[]
  exec?: UpdateExec
  now?: () => Date
  assembleArtifact?: AssembleBackendRuntimeArtifact
  /** Safety seams: foundation deliberately never invokes these. */
  stopDaemon?: () => Promise<void>
  activateRelease?: (name: string) => Promise<void>
}
export type AssembleBackendRuntimeArtifact = (options: {
  buildDir: string
  artifactDir: string
  release: string
  exec: UpdateExec
}) => Promise<string>
export interface PreparedBackendRelease {
  outcome: 'installed' | 'already_present'
  name: string
  manifest: BackendDistributionManifest
}

export class BackendUpdatePreflightError extends Error {
  constructor(
    public readonly code:
      | 'INVALID_REVISION'
      | 'DIRTY_CHECKOUT'
      | 'DIVERGENT_CHECKOUT'
      | 'MISSING_LOCKFILE'
      | 'COMMAND_FAILED'
      | 'UNSAFE_ARTIFACT'
      | 'UNSUPPORTED_RUNTIME',
    message: string,
  ) {
    super(message)
    this.name = 'BackendUpdatePreflightError'
  }
}

export function assertBackendRuntimeCompatibility(
  nodeVersion: string = process.versions.node,
  platform: string = process.platform,
  arch: string = process.arch,
): void {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(nodeVersion)
  if (!match)
    throw new BackendUpdatePreflightError(
      'UNSUPPORTED_RUNTIME',
      'Node runtime version is malformed',
    )
  const major = Number(match[1])
  const minor = Number(match[2])
  if (major < 20 || (major === 20 && minor < 19) || major >= 23) {
    throw new BackendUpdatePreflightError(
      'UNSUPPORTED_RUNTIME',
      'Node runtime does not satisfy >=20.19 <23',
    )
  }
  if (!/^[a-z0-9_-]+$/.test(platform) || !/^[a-z0-9_-]+$/.test(arch)) {
    throw new BackendUpdatePreflightError(
      'UNSUPPORTED_RUNTIME',
      'platform or architecture is invalid',
    )
  }
}

const defaultExec: UpdateExec = async (command, args, options) => {
  try {
    const result = await execFilePromise(command, [...args], { cwd: options.cwd })
    return { stdout: result.stdout, stderr: result.stderr }
  } catch {
    throw new BackendUpdatePreflightError('COMMAND_FAILED', 'release preflight command failed')
  }
}

async function git(exec: UpdateExec, cwd: string, args: readonly string[]): Promise<string> {
  try {
    return (await exec('git', args, { cwd })).stdout.trim()
  } catch (error) {
    if (error instanceof BackendUpdatePreflightError) throw error
    throw new BackendUpdatePreflightError('COMMAND_FAILED', 'Git preflight failed')
  }
}

export async function assertBackendUpdatePreflight(
  checkoutDir: string,
  targetRevision: string,
  exec: UpdateExec = defaultExec,
): Promise<void> {
  if (!EXACT_REVISION_PATTERN.test(targetRevision))
    throw new BackendUpdatePreflightError(
      'INVALID_REVISION',
      'target revision must be an exact 40-character commit SHA',
    )
  const status = await git(exec, checkoutDir, ['status', '--porcelain=v1', '--untracked-files=all'])
  if (status)
    throw new BackendUpdatePreflightError('DIRTY_CHECKOUT', 'checkout has unexpected changes')
  const [head, target] = await Promise.all([
    git(exec, checkoutDir, ['rev-parse', '--verify', 'HEAD^{commit}']),
    git(exec, checkoutDir, ['rev-parse', '--verify', `${targetRevision}^{commit}`]),
  ])
  if (target !== targetRevision || head !== targetRevision)
    throw new BackendUpdatePreflightError(
      'DIVERGENT_CHECKOUT',
      'checkout HEAD does not equal the pinned target revision',
    )
  try {
    await fs.access(join(checkoutDir, 'pnpm-lock.yaml'))
  } catch {
    throw new BackendUpdatePreflightError('MISSING_LOCKFILE', 'pnpm-lock.yaml is required')
  }
}

function pathWithin(root: string, target: string): boolean {
  const rel = relative(root, target)
  return rel === '' || (!rel.startsWith(`..${sep}`) && rel !== '..' && !isAbsolute(rel))
}

function pathsOverlap(a: string, b: string): boolean {
  return pathWithin(a, b) || pathWithin(b, a)
}

async function copyCheckout(source: string, destination: string, exec: UpdateExec): Promise<void> {
  if (pathsOverlap(resolve(source), resolve(destination))) {
    throw new BackendUpdatePreflightError(
      'UNSAFE_ARTIFACT',
      'staging directory must be separate from the checkout',
    )
  }
  const tracked = (await exec('git', ['ls-files', '-z'], { cwd: source })).stdout
    .split('\0')
    .filter(Boolean)
  await fs.rm(destination, { recursive: true, force: true })
  await fs.mkdir(destination, { recursive: true, mode: 0o700 })
  for (const file of tracked) {
    if (isAbsolute(file) || file.split(/[\\/]/).some((segment) => segment === '..')) {
      throw new BackendUpdatePreflightError('UNSAFE_ARTIFACT', 'Git returned an unsafe path')
    }
    const sourcePath = join(source, file)
    const stat = await fs.lstat(sourcePath)
    if (!stat.isFile() || stat.isSymbolicLink()) {
      throw new BackendUpdatePreflightError(
        'UNSAFE_ARTIFACT',
        'tracked release inputs must be regular files',
      )
    }
    const destinationPath = join(destination, file)
    await fs.mkdir(dirname(destinationPath), { recursive: true })
    await fs.copyFile(sourcePath, destinationPath)
    await fs.chmod(destinationPath, stat.mode & 0o777)
  }
}

async function removeDependencyTrees(dir: string): Promise<void> {
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.name === 'node_modules') {
      await fs.rm(path, { recursive: true, force: true })
      continue
    }
    if (entry.isDirectory()) await removeDependencyTrees(path)
  }
}

async function sanitizeRuntimeArtifactSymlinks(root: string, directory = root): Promise<void> {
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) {
      await sanitizeRuntimeArtifactSymlinks(root, path)
      continue
    }
    if (!entry.isSymbolicLink()) continue
    let target: string
    try {
      target = await fs.realpath(path)
    } catch {
      throw new BackendUpdatePreflightError(
        'UNSAFE_ARTIFACT',
        'runtime artifact contains a broken symlink',
      )
    }
    if (!pathWithin(root, target)) {
      const artifactPath = relative(root, path).split(sep).join('/')
      if (artifactPath === 'packages/cli/node_modules/.pnpm/node_modules/@memon/cli') {
        await fs.unlink(path)
        continue
      }
      throw new BackendUpdatePreflightError(
        'UNSAFE_ARTIFACT',
        'runtime artifact symlink escapes its immutable release',
      )
    }
  }
}

function isFirstPartyDistPath(root: string, path: string): boolean {
  const normalized = relative(root, path).split(sep).join('/')
  return (
    normalized.startsWith('packages/cli/dist/') ||
    /(?:^|\/)node_modules\/@memon\/(?:core|backend|cli|skills)\/dist\//.test(normalized)
  )
}

async function assertNoCompiledTests(directory: string, root: string = directory): Promise<void> {
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) {
      await assertNoCompiledTests(path, root)
      continue
    }
    if (
      isFirstPartyDistPath(root, path) &&
      /\.(?:test|spec)\.(?:js|d\.ts)(?:\.map)?$/.test(entry.name)
    ) {
      throw new BackendUpdatePreflightError(
        'UNSAFE_ARTIFACT',
        'runtime artifact contains compiled test output',
      )
    }
  }
}

/** Assemble the tested workspace into a self-contained production CLI/Backend artifact. */
export const assembleBackendRuntimeArtifact: AssembleBackendRuntimeArtifact = async ({
  buildDir,
  artifactDir,
  release,
  exec,
}) => {
  if (pathsOverlap(resolve(buildDir), resolve(artifactDir))) {
    throw new BackendUpdatePreflightError(
      'UNSAFE_ARTIFACT',
      'runtime artifact directory must be separate from its build directory',
    )
  }
  await fs.rm(artifactDir, { recursive: true, force: true })
  await fs.mkdir(artifactDir, { recursive: true, mode: 0o700 })
  const cliRoot = join(artifactDir, 'packages', 'cli')
  await fs.mkdir(dirname(cliRoot), { recursive: true, mode: 0o700 })
  await exec('pnpm', ['--filter', '@memon/cli', 'deploy', '--prod', '--legacy', cliRoot], {
    cwd: buildDir,
  })
  await sanitizeRuntimeArtifactSymlinks(artifactDir)
  await assertNoCompiledTests(artifactDir)
  const cliEntry = join(cliRoot, 'dist', 'index.js')
  const [entryStat, dependencyStat] = await Promise.all([
    fs.lstat(cliEntry),
    fs.lstat(join(cliRoot, 'node_modules')),
  ]).catch(() => {
    throw new BackendUpdatePreflightError(
      'UNSAFE_ARTIFACT',
      'runtime artifact is missing its CLI entry or production dependencies',
    )
  })
  if (!entryStat.isFile() || entryStat.isSymbolicLink() || !dependencyStat.isDirectory()) {
    throw new BackendUpdatePreflightError(
      'UNSAFE_ARTIFACT',
      'runtime artifact entry or dependency directory is unsafe',
    )
  }
  const smoke = await exec(process.execPath, [cliEntry, '--version'], { cwd: artifactDir })
  if (smoke.stdout.trim() !== release) {
    throw new BackendUpdatePreflightError(
      'UNSAFE_ARTIFACT',
      'runtime artifact reports an unexpected release',
    )
  }
  return artifactDir
}

export async function prepareBackendRelease(
  options: PrepareBackendReleaseOptions,
): Promise<PreparedBackendRelease> {
  const exec = options.exec ?? defaultExec
  const release = options.release ?? MEMON_RELEASE
  const artifactDir = `${options.stagingDir}.runtime`
  assertBackendRuntimeCompatibility()
  await assertBackendUpdatePreflight(options.checkoutDir, options.targetRevision, exec)
  try {
    await copyCheckout(options.checkoutDir, options.stagingDir, exec)
    for (const command of options.commands ?? DEFAULT_BACKEND_BUILD_COMMANDS) {
      await exec(command.command, command.args, { cwd: options.stagingDir })
    }
    await removeDependencyTrees(options.stagingDir)
    const assembled = await (options.assembleArtifact ?? assembleBackendRuntimeArtifact)({
      buildDir: options.stagingDir,
      artifactDir,
      release,
      exec,
    })
    const manifest: BackendDistributionManifest = {
      version: 1,
      release,
      revision: options.targetRevision,
      artifactSha256: await computeReleaseTreeSha256(assembled),
      platform: process.platform,
      arch: process.arch,
      nodeRange: options.nodeRange ?? '>=20.19 <23',
      createdAt: (options.now ?? (() => new Date()))().toISOString(),
    }
    const installed = await options.releaseStore.installFromStaging(assembled, manifest)
    await fs.rm(options.stagingDir, { recursive: true, force: true })
    return { ...installed, manifest }
  } catch (error) {
    await Promise.all([
      fs.rm(options.stagingDir, { recursive: true, force: true }),
      fs.rm(artifactDir, { recursive: true, force: true }),
    ])
    throw error
  }
}
