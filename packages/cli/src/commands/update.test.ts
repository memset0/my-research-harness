import { execFileSync } from 'node:child_process'
import { promises as fs } from 'node:fs'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { updateInstallation } from './update.js'

// `memon update` is the only self-maintenance path a CLI node has, so these
// cases pin its safety contract: never rewrite or discard local work, and
// never leave a node without a working `memon` when an installation step
// fails. Real git and real pnpm run against throwaway workspaces, because the
// decisions under test are git decisions and process outcomes, not our own
// bookkeeping.

let root: string
let upstream: string
let install: string

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 'memon test',
      GIT_AUTHOR_EMAIL: 'test@example.test',
      GIT_COMMITTER_NAME: 'memon test',
      GIT_COMMITTER_EMAIL: 'test@example.test',
    },
  })
}

/**
 * Throwaway stand-in for a published memon checkout: a pnpm workspace with
 * `@memon/core` and `@memon/cli`, each building through a script the test can
 * make succeed or fail. The built CLI answers `--version` and records its
 * `install-skills` argv, which is how the updater's delegation is observed.
 */
async function seedCheckout(
  dir: string,
  marker: string,
  options: { failBuild?: boolean; editDuringBuild?: boolean } = {},
): Promise<void> {
  await fs.mkdir(join(dir, 'packages', 'core'), { recursive: true })
  await fs.mkdir(join(dir, 'packages', 'cli'), { recursive: true })
  await writeFile(join(dir, 'pnpm-workspace.yaml'), "packages:\n  - 'packages/*'\n")
  await writeFile(
    join(dir, 'package.json'),
    `${JSON.stringify({ name: 'memon-fixture', private: true, packageManager: 'pnpm@10.33.2' }, null, 2)}\n`,
  )
  for (const name of ['core', 'cli'] as const) {
    await writeFile(
      join(dir, 'packages', name, 'package.json'),
      `${JSON.stringify(
        {
          name: `@memon/${name}`,
          version: '0.0.0',
          private: true,
          scripts: { build: 'node build.mjs' },
        },
        null,
        2,
      )}\n`,
    )
  }
  await writeFile(
    join(dir, 'packages', 'core', 'build.mjs'),
    "import { mkdirSync, writeFileSync } from 'node:fs'\nmkdirSync('dist', { recursive: true })\nwriteFileSync('dist/index.js', 'core\\n')\n",
  )
  const failingBuild = options.editDuringBuild
    ? // Simulates a user editing a tracked file while the build runs: the
      // rollback must not be allowed to discard it.
      "import { writeFileSync } from 'node:fs'\nwriteFileSync('../../marker.txt', 'edited during the update\\n')\nprocess.exit(1)\n"
    : "process.stderr.write('fixture build failure\\n')\nprocess.exit(1)\n"
  await writeFile(
    join(dir, 'packages', 'cli', 'build.mjs'),
    options.failBuild || options.editDuringBuild
      ? failingBuild
      : `import { mkdirSync, writeFileSync } from 'node:fs'
mkdirSync('dist', { recursive: true })
writeFileSync(
  'dist/index.js',
  \`const argv = process.argv.slice(2)
if (argv.includes('--version')) {
  process.stdout.write('6.0.0-${marker}\\\\n')
} else if (argv.includes('install-skills')) {
  const root = argv[argv.indexOf('--project-root') + 1]
  process.stdout.write(JSON.stringify({ marker: '${marker}', projectRoot: root }) + '\\\\n')
} else {
  process.exit(2)
}
\`,
)
`,
  )
  await writeFile(join(dir, 'marker.txt'), `${marker}\n`)
}

function options(overrides: Record<string, unknown> = {}) {
  return {
    cwd: install,
    format: 'json' as const,
    source: install,
    skillsRoots: [] as string[],
    skills: false,
    dryRun: false,
    ...overrides,
  }
}

async function publishUpstream(
  marker: string,
  options: { failBuild?: boolean; editDuringBuild?: boolean } = {},
) {
  await seedCheckout(upstream, marker, options)
  git(upstream, 'add', '.')
  git(upstream, 'commit', '-m', marker)
}

/** Stand-in for the previously installed CLI build: answers `--version`. */
const PREVIOUS_BUILD = "process.stdout.write('6.0.0-previous\\n')\n"

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'memon-update-test-'))
  upstream = join(root, 'upstream')
  install = join(root, 'install')
  await fs.mkdir(upstream, { recursive: true })
  git(upstream, 'init', '--initial-branch=main')
  await publishUpstream('v1')

  git(root, 'clone', '--branch', 'main', upstream, install)
  // A previously built, *runnable* CLI: rollback must leave a node whose
  // `memon` still answers, not merely a restored file.
  await fs.mkdir(join(install, 'packages', 'cli', 'dist'), { recursive: true })
  await writeFile(join(install, 'packages', 'cli', 'dist', 'index.js'), PREVIOUS_BUILD)
})

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true })
})

describe('memon update', () => {
  it('fast-forwards, rebuilds the CLI, and refreshes managed skills', async () => {
    await publishUpstream('v2')
    const target = git(upstream, 'rev-parse', 'HEAD').trim()
    const skillsRoot = join(root, 'project')
    await fs.mkdir(skillsRoot, { recursive: true })

    const result = await updateInstallation(options({ skills: true, skillsRoots: [skillsRoot] }))

    expect(result.outcome, JSON.stringify(result.steps)).toBe('updated')
    expect(result.selectedRevision).toBe(target)
    expect(git(install, 'rev-parse', 'HEAD').trim()).toBe(target)
    expect(await readFile(join(install, 'marker.txt'), 'utf8')).toBe('v2\n')
    expect(result.installedRelease).toBe('6.0.0-v2')
    // The refresh runs through the freshly built CLI's own install-skills.
    expect(result.skills).toEqual([
      { projectRoot: skillsRoot, outcome: 'ok', report: { marker: 'v2', projectRoot: skillsRoot } },
    ])
    expect(result.steps.filter((step) => step.outcome === 'failed')).toEqual([])
  }, 180_000)

  it('refuses a dirty checkout and keeps the local edit', async () => {
    await publishUpstream('v2')
    await writeFile(join(install, 'marker.txt'), 'local work in progress\n')
    const previous = git(install, 'rev-parse', 'HEAD').trim()

    const result = await updateInstallation(options())

    expect(result).toMatchObject({ outcome: 'refused', reason: 'dirty_source' })
    expect(await readFile(join(install, 'marker.txt'), 'utf8')).toBe('local work in progress\n')
    expect(git(install, 'rev-parse', 'HEAD').trim()).toBe(previous)
  })

  it('refuses divergent history instead of rewriting it', async () => {
    await publishUpstream('v2')
    await writeFile(join(install, 'local.txt'), 'local commit\n')
    git(install, 'add', 'local.txt')
    git(install, 'commit', '-m', 'local')
    const localHead = git(install, 'rev-parse', 'HEAD').trim()

    const result = await updateInstallation(options())

    expect(result).toMatchObject({ outcome: 'refused', reason: 'divergent' })
    expect(git(install, 'rev-parse', 'HEAD').trim()).toBe(localHead)
    expect(await readFile(join(install, 'local.txt'), 'utf8')).toBe('local commit\n')
  })

  it('reports the selected upstream revision without touching the checkout in a dry run', async () => {
    await publishUpstream('v2')
    const previous = git(install, 'rev-parse', 'HEAD').trim()

    const result = await updateInstallation(options({ dryRun: true }))

    expect(result.outcome).toBe('dry_run')
    expect(result.selectedRevision).toBe(git(upstream, 'rev-parse', 'HEAD').trim())
    expect(result.upstream).toMatchObject({ remote: 'origin', branch: 'main' })
    expect(git(install, 'rev-parse', 'HEAD').trim()).toBe(previous)
    expect(await readFile(join(install, 'marker.txt'), 'utf8')).toBe('v1\n')
  })

  it('restores a usable previous installation when the new build fails', async () => {
    await publishUpstream('v2', { failBuild: true })
    const previous = git(install, 'rev-parse', 'HEAD').trim()

    const result = await updateInstallation(options())

    expect(result).toMatchObject({
      outcome: 'rolled_back',
      reason: 'build_failed',
      installedRelease: '6.0.0-previous',
      backup: null,
    })
    expect(git(install, 'rev-parse', 'HEAD').trim()).toBe(previous)
    expect(await readFile(join(install, 'marker.txt'), 'utf8')).toBe('v1\n')
    expect(await readFile(join(install, 'packages', 'cli', 'dist', 'index.js'), 'utf8')).toBe(
      PREVIOUS_BUILD,
    )
  }, 180_000)

  it('refuses to roll back over a file edited while the update was running', async () => {
    await publishUpstream('v2', { editDuringBuild: true })
    const target = git(upstream, 'rev-parse', 'HEAD').trim()

    const result = await updateInstallation(options())

    // The failing build edited a tracked file; moving the ref back would
    // discard it, so the command reports manual repair instead.
    expect(result).toMatchObject({ outcome: 'failed', reason: 'rollback_failed' })
    expect(await readFile(join(install, 'marker.txt'), 'utf8')).toBe('edited during the update\n')
    expect(git(install, 'rev-parse', 'HEAD').trim()).toBe(target)
    expect(result.backup).toMatch(/memon-update-backup-/)
    expect(result.message).toMatch(/nothing was moved/)
  }, 180_000)

  it('refuses a checkout without a configured upstream', async () => {
    const standalone = join(root, 'standalone')
    await fs.mkdir(standalone, { recursive: true })
    git(standalone, 'init', '--initial-branch=main')
    await seedCheckout(standalone, 'v1')
    git(standalone, 'add', '.')
    git(standalone, 'commit', '-m', 'v1')

    const result = await updateInstallation(options({ cwd: standalone, source: standalone }))

    expect(result).toMatchObject({ outcome: 'refused', reason: 'no_upstream' })
  })

  it('rejects a URL as --remote so only configured remotes are trusted', async () => {
    const result = await updateInstallation(
      options({ remote: 'https://example.test/memon.git', branch: 'main' }),
    )

    expect(result).toMatchObject({ outcome: 'refused', reason: 'untrusted_remote' })
  })
})
