import { execFile } from 'node:child_process'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BackendReleaseStore } from '../distribution/release-store.js'
import {
  type AssembleBackendRuntimeArtifact,
  assembleBackendRuntimeArtifact,
  assertBackendRuntimeCompatibility,
  assertBackendUpdatePreflight,
  DEFAULT_BACKEND_BUILD_COMMANDS,
  prepareBackendRelease,
} from './preflight.js'
import { generateBackendServiceToken } from './token.js'

const run = promisify(execFile)
const passthroughArtifact: AssembleBackendRuntimeArtifact = async ({ buildDir }) => buildDir
let dir: string
beforeEach(async () => {
  dir = await fs.mkdtemp(join(tmpdir(), 'memon-update-'))
})
afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true })
})

async function repo(
  withLock = true,
  name = 'checkout',
): Promise<{ path: string; revision: string }> {
  const path = join(dir, name)
  await fs.mkdir(path)
  await run('git', ['init', '-q'], { cwd: path })
  await run('git', ['config', 'user.email', 'test@example.test'], { cwd: path })
  await run('git', ['config', 'user.name', 'Test'], { cwd: path })
  if (withLock) await fs.writeFile(join(path, 'pnpm-lock.yaml'), "lockfileVersion: '9.0'\n")
  await fs.writeFile(join(path, '.gitignore'), 'ignored.cache\n')
  await fs.writeFile(join(path, 'artifact.txt'), 'source')
  await run('git', ['add', '.'], { cwd: path })
  await run('git', ['commit', '-qm', 'initial'], { cwd: path })
  return { path, revision: (await run('git', ['rev-parse', 'HEAD'], { cwd: path })).stdout.trim() }
}

describe('Backend update preflight', () => {
  it('fails closed on unsupported Node runtime/platform metadata', () => {
    expect(() => assertBackendRuntimeCompatibility('20.18.0')).toThrowError(
      expect.objectContaining({ code: 'UNSUPPORTED_RUNTIME' }),
    )
    expect(() => assertBackendRuntimeCompatibility('23.0.0')).toThrowError(
      expect.objectContaining({ code: 'UNSUPPORTED_RUNTIME' }),
    )
    expect(() => assertBackendRuntimeCompatibility('22.1.0', 'linux;rm', 'x64')).toThrowError(
      expect.objectContaining({ code: 'UNSUPPORTED_RUNTIME' }),
    )
    expect(() => assertBackendRuntimeCompatibility('22.1.0', 'linux', 'x64')).not.toThrow()
  })

  it('uses frozen install/build/tests and contains no destructive Git operation', () => {
    const serialized = JSON.stringify(DEFAULT_BACKEND_BUILD_COMMANDS)
    expect(serialized).toContain('--frozen-lockfile')
    for (const name of ['core', 'backend', 'cli']) {
      expect(serialized).toContain(`@memon/${name}`)
      expect(serialized).toContain('build')
      expect(serialized).toContain('test')
    }
    expect(serialized).not.toMatch(/reset|autostash|checkout|latest/)
  })
  it('accepts only a clean checkout whose HEAD equals the exact target SHA', async () => {
    const checkout = await repo()
    await expect(
      assertBackendUpdatePreflight(checkout.path, checkout.revision),
    ).resolves.toBeUndefined()
    await expect(assertBackendUpdatePreflight(checkout.path, 'latest')).rejects.toMatchObject({
      code: 'INVALID_REVISION',
    })
    await expect(assertBackendUpdatePreflight(checkout.path, 'main')).rejects.toMatchObject({
      code: 'INVALID_REVISION',
    })
    await fs.writeFile(join(checkout.path, 'dirty.txt'), 'dirty')
    await expect(
      assertBackendUpdatePreflight(checkout.path, checkout.revision),
    ).rejects.toMatchObject({ code: 'DIRTY_CHECKOUT' })
  })

  it('rejects divergent HEAD and missing lockfile', async () => {
    const checkout = await repo()
    const first = checkout.revision
    await fs.writeFile(join(checkout.path, 'artifact.txt'), 'second')
    await run('git', ['commit', '-qam', 'second'], { cwd: checkout.path })
    await expect(assertBackendUpdatePreflight(checkout.path, first)).rejects.toMatchObject({
      code: 'DIVERGENT_CHECKOUT',
    })
    const missing = await repo(false, 'missing-lock')
    await expect(
      assertBackendUpdatePreflight(missing.path, missing.revision),
    ).rejects.toMatchObject({ code: 'MISSING_LOCKFILE' })
  })

  it('keeps daemon stop and active pointer untouched when a build command fails', async () => {
    const checkout = await repo()
    const stop = vi.fn()
    const activate = vi.fn()
    const exec = vi.fn(
      async (command: string, args: readonly string[], options: { cwd: string }) => {
        if (command === 'git') {
          const result = await run(command, [...args], options)
          return { stdout: result.stdout, stderr: result.stderr }
        }
        throw new Error('build failed')
      },
    )
    await expect(
      prepareBackendRelease({
        checkoutDir: checkout.path,
        stagingDir: join(dir, 'staging'),
        targetRevision: checkout.revision,
        releaseStore: new BackendReleaseStore(join(dir, 'store')),
        commands: [{ command: 'pnpm', args: ['build'] }],
        exec,
        stopDaemon: stop,
        activateRelease: activate,
      }),
    ).rejects.toThrow()
    expect(stop).not.toHaveBeenCalled()
    expect(activate).not.toHaveBeenCalled()
  })

  it('keeps live state untouched when revision preflight fails before staging', async () => {
    const checkout = await repo()
    const stop = vi.fn()
    const activate = vi.fn()
    const stagingDir = join(dir, 'never-staged')
    await expect(
      prepareBackendRelease({
        checkoutDir: checkout.path,
        stagingDir,
        targetRevision: 'latest',
        releaseStore: new BackendReleaseStore(join(dir, 'store-never')),
        commands: [],
        stopDaemon: stop,
        activateRelease: activate,
      }),
    ).rejects.toMatchObject({ code: 'INVALID_REVISION' })
    expect(stop).not.toHaveBeenCalled()
    expect(activate).not.toHaveBeenCalled()
    await expect(fs.access(stagingDir)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('installs a successful staged build whose manifest matches immutable bytes', async () => {
    const checkout = await repo()
    const store = new BackendReleaseStore(join(dir, 'store-success'))
    const prepared = await prepareBackendRelease({
      checkoutDir: checkout.path,
      stagingDir: join(dir, 'staging-success'),
      targetRevision: checkout.revision,
      releaseStore: store,
      commands: [],
      assembleArtifact: passthroughArtifact,
      now: () => new Date('2026-08-26T18:00:00.000Z'),
    })
    expect(prepared).toMatchObject({ outcome: 'installed', name: `6.0.0-${checkout.revision}` })
    expect((await store.status()).current).toBeNull()
    expect(prepared.manifest.artifactSha256).toMatch(/^[a-f0-9]{64}$/)
  })

  it('copies only tracked regular files into the immutable release', async () => {
    const checkout = await repo()
    await fs.writeFile(join(checkout.path, 'ignored.cache'), 'local build residue')
    const store = new BackendReleaseStore(join(dir, 'store-tracked-only'))
    const prepared = await prepareBackendRelease({
      checkoutDir: checkout.path,
      stagingDir: join(dir, 'staging-tracked-only'),
      targetRevision: checkout.revision,
      releaseStore: store,
      commands: [],
      assembleArtifact: passthroughArtifact,
    })
    await expect(fs.access(join(store.root, prepared.name, 'ignored.cache'))).rejects.toMatchObject(
      { code: 'ENOENT' },
    )
    await expect(
      fs.readFile(join(store.root, prepared.name, 'artifact.txt'), 'utf8'),
    ).resolves.toBe('source')
  })

  it('rejects a staging directory nested in the checkout before copying', async () => {
    const checkout = await repo()
    await expect(
      prepareBackendRelease({
        checkoutDir: checkout.path,
        stagingDir: join(checkout.path, 'staging'),
        targetRevision: checkout.revision,
        releaseStore: new BackendReleaseStore(join(dir, 'store-overlap')),
        commands: [],
      }),
    ).rejects.toMatchObject({ code: 'UNSAFE_ARTIFACT' })
    await expect(fs.access(join(checkout.path, 'staging'))).rejects.toMatchObject({
      code: 'ENOENT',
    })
  })

  it('assembles a production CLI artifact, removes only the external self-link, and smoke checks it', async () => {
    const buildDir = join(dir, 'runtime-build')
    const artifactDir = join(dir, 'runtime-artifact')
    await fs.mkdir(buildDir)
    const exec = vi.fn(
      async (command: string, args: readonly string[], _options: { cwd: string }) => {
        if (command === 'pnpm') {
          const cliRoot = args.at(-1)!
          await fs.mkdir(join(cliRoot, 'dist'), { recursive: true })
          await fs.mkdir(join(cliRoot, 'node_modules', 'vendor'), { recursive: true })
          await fs.mkdir(join(cliRoot, 'node_modules', '.pnpm', 'node_modules', '@memon'), {
            recursive: true,
          })
          await fs.writeFile(join(cliRoot, 'dist', 'index.js'), 'runtime entry')
          await fs.writeFile(
            join(cliRoot, 'node_modules', 'vendor', 'upstream.test.js'),
            'third-party package fixture',
          )
          await fs.symlink('vendor', join(cliRoot, 'node_modules', 'dependency'))
          await fs.symlink(
            buildDir,
            join(cliRoot, 'node_modules', '.pnpm', 'node_modules', '@memon', 'cli'),
          )
          return { stdout: '', stderr: '' }
        }
        expect(command).toBe(process.execPath)
        return { stdout: '6.0.0\n', stderr: '' }
      },
    )
    await expect(
      assembleBackendRuntimeArtifact({
        buildDir,
        artifactDir,
        release: '6.0.0',
        exec,
      }),
    ).resolves.toBe(artifactDir)
    expect(
      await fs.readlink(join(artifactDir, 'packages', 'cli', 'node_modules', 'dependency')),
    ).toBe('vendor')
    await expect(
      fs.readFile(
        join(artifactDir, 'packages', 'cli', 'node_modules', 'vendor', 'upstream.test.js'),
        'utf8',
      ),
    ).resolves.toBe('third-party package fixture')
    await expect(
      fs.access(
        join(
          artifactDir,
          'packages',
          'cli',
          'node_modules',
          '.pnpm',
          'node_modules',
          '@memon',
          'cli',
        ),
      ),
    ).rejects.toMatchObject({ code: 'ENOENT' })
    expect(exec).toHaveBeenCalledWith(
      'pnpm',
      [
        '--filter',
        '@memon/cli',
        'deploy',
        '--prod',
        '--legacy',
        join(artifactDir, 'packages', 'cli'),
      ],
      { cwd: buildDir },
    )
  })

  it('rejects compiled tests from a first-party dist while ignoring dependency source tests', async () => {
    const buildDir = join(dir, 'runtime-build-first-party-test')
    const artifactDir = join(dir, 'runtime-artifact-first-party-test')
    await fs.mkdir(buildDir)
    const exec = vi.fn(
      async (command: string, args: readonly string[], _options: { cwd: string }) => {
        expect(command).toBe('pnpm')
        const cliRoot = args.at(-1)!
        await fs.mkdir(join(cliRoot, 'dist'), { recursive: true })
        await fs.mkdir(join(cliRoot, 'node_modules', 'vendor'), { recursive: true })
        await fs.writeFile(join(cliRoot, 'dist', 'index.js'), 'runtime entry')
        await fs.writeFile(join(cliRoot, 'dist', 'leaked.test.js'), 'compiled test')
        await fs.writeFile(
          join(cliRoot, 'node_modules', 'vendor', 'upstream.test.js'),
          'dependency source test',
        )
        return { stdout: '', stderr: '' }
      },
    )
    await expect(
      assembleBackendRuntimeArtifact({
        buildDir,
        artifactDir,
        release: '6.0.0',
        exec,
      }),
    ).rejects.toMatchObject({ code: 'UNSAFE_ARTIFACT' })
  })

  it('generates an explicit 256-bit base64url token', () => {
    const token = generateBackendServiceToken((size) => Buffer.alloc(size, 7))
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(token).not.toContain('=')
  })
})
