import { execFile } from 'node:child_process'
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it } from 'vitest'

const runFile = promisify(execFile)
const script = fileURLToPath(
  new URL('../../migrations/scripts/v5-to-v6-stage.mjs', import.meta.url),
)
const cleanup: string[] = []

async function fixture(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), 'memon-v5-to-v6-'))
  cleanup.push(root)
  await mkdir(path.join(root, '.memon'), { recursive: true })
  await mkdir(path.join(root, 'docs', 'experiments', 'E0001-demo'), { recursive: true })
  await writeFile(
    path.join(root, '.memon', 'version.json'),
    `${JSON.stringify({ fs_convention_version: 5, installed_at: '2026-01-01T00:00:00Z' }, null, 2)}\n`,
  )
  await writeFile(
    path.join(root, 'docs', 'experiments', 'E0001-demo', 'README.md'),
    '# Demo\n\n## Plan\n\n- [ ] compare variants\n',
  )
  return root
}

async function run(root: string, ...args: string[]) {
  return runFile(process.execPath, [script, ...args], { cwd: root })
}

async function fakeMemon(root: string, failLint = false, failStaged = false): Promise<string> {
  const executable = path.join(root, '.memon', failLint ? 'bad-memon.mjs' : 'fake-memon.mjs')
  await writeFile(
    executable,
    `#!/usr/bin/env node
import { appendFileSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
const args = process.argv.slice(2)
const projectRoot = args[args.indexOf('--project-root') + 1]
const marker = JSON.parse(readFileSync(join(projectRoot, '.memon', 'version.json'), 'utf8'))
if (marker.fs_convention_version !== 5) {
  process.stderr.write('marker advanced before production checks\\n')
  process.exit(1)
}
appendFileSync(join(projectRoot, '.memon', 'fake-memon.log'), args.join(' ') + '\\n')
if (${JSON.stringify(failLint)} && !projectRoot.endsWith('staged-validation') && args.includes('lint')) {
  process.stdout.write('{"ok":false,"diagnostics":[{"severity":"error"}]}\\n')
  process.exit(1)
}
if (${JSON.stringify(failStaged)} && projectRoot.endsWith('staged-validation') && args.includes('validate')) {
  process.stdout.write('{"ok":false,"diagnostics":[{"severity":"error"}]}\\n')
  process.exit(1)
}
if (args.includes('json')) process.stdout.write('{"ok":true}\\n')
else process.stdout.write('_rendered section_\\n')
`,
  )
  await chmod(executable, 0o700)
  return executable
}

afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

describe('v5-to-v6 staged migration executor', () => {
  it('keeps live files untouched until every approved candidate is explicitly published', async () => {
    const root = await fixture()
    const memonBin = await fakeMemon(root)
    const staging = path.join(root, '.memon', 'migrations', 'v5-to-v6', 'review-1')
    await run(root, 'init', '--project-root', root, '--migration-id', 'review-1')

    const liveDir = path.join(root, 'docs', 'experiments', 'E0001-demo')
    await expect(readFile(path.join(liveDir, 'implementation.yaml'), 'utf8')).rejects.toThrow()

    await run(root, 'approve', '--staging', staging, '--experiment', 'E0001-demo')
    const stagedResults = path.join(staging, 'experiments', 'E0001-demo', 'results.yaml')
    await writeFile(
      stagedResults,
      'schema_version: 1\ncolumns: []\nvariants: []\n# reviewed edit\n',
    )
    const status = await run(root, 'status', '--staging', staging)
    expect(status.stdout).toContain('E0001-demo\tSTALE')
    await expect(run(root, 'verify', '--staging', staging)).rejects.toMatchObject({
      stderr: expect.stringContaining('status is STALE'),
    })

    await run(root, 'approve', '--staging', staging, '--experiment', 'E0001-demo')
    await expect(run(root, 'publish', '--staging', staging)).rejects.toMatchObject({
      stderr: expect.stringContaining('missing --confirm'),
    })
    expect(
      JSON.parse(await readFile(path.join(root, '.memon', 'version.json'), 'utf8')),
    ).toHaveProperty('fs_convention_version', 5)

    await run(
      root,
      'publish',
      '--staging',
      staging,
      '--confirm',
      'review-1',
      '--memon-bin',
      memonBin,
    )
    expect(await readFile(path.join(liveDir, 'results.yaml'), 'utf8')).toContain('# reviewed edit')
    const productionChecks = await readFile(path.join(root, '.memon', 'fake-memon.log'), 'utf8')
    expect(productionChecks.trim().split('\n')).toHaveLength(5)
    expect(productionChecks).toContain('experiment doc validate E0001-demo')
    expect(productionChecks).toContain('experiment doc lint E0001-demo')
    expect(productionChecks).toContain('experiment doc render E0001-demo results')
    expect(
      JSON.parse(await readFile(path.join(root, '.memon', 'version.json'), 'utf8')),
    ).toHaveProperty('fs_convention_version', 6)
  })

  it('uses the local Git exclude and refuses a dirty Git worktree', async () => {
    const root = await fixture()
    await runFile('git', ['init', '-q', root])
    await runFile('git', ['-C', root, 'config', 'user.email', 'test@memon.invalid'])
    await runFile('git', ['-C', root, 'config', 'user.name', 'memon test'])
    await runFile('git', ['-C', root, 'add', '.'])
    await runFile('git', ['-C', root, 'commit', '-qm', 'fixture'])

    await run(root, 'init', '--project-root', root, '--migration-id', 'clean')
    const excludePath = (
      await runFile('git', ['-C', root, 'rev-parse', '--git-path', 'info/exclude'])
    ).stdout.trim()
    expect(await readFile(path.resolve(root, excludePath), 'utf8')).toContain('/.memon/migrations/')

    await writeFile(
      path.join(root, 'docs', 'experiments', 'E0001-demo', 'README.md'),
      '# user edit\n',
    )
    await expect(
      run(root, 'init', '--project-root', root, '--migration-id', 'dirty'),
    ).rejects.toMatchObject({ stderr: expect.stringContaining('Git worktree is dirty') })
  })

  it('rolls live files and the marker back when production lint fails', async () => {
    const root = await fixture()
    const memonBin = await fakeMemon(root, true)
    const staging = path.join(root, '.memon', 'migrations', 'v5-to-v6', 'rollback')
    const liveDir = path.join(root, 'docs', 'experiments', 'E0001-demo')
    const originalReadme = await readFile(path.join(liveDir, 'README.md'), 'utf8')

    await run(root, 'init', '--project-root', root, '--migration-id', 'rollback')
    await run(root, 'approve', '--staging', staging, '--experiment', 'E0001-demo')
    await expect(
      run(root, 'publish', '--staging', staging, '--confirm', 'rollback', '--memon-bin', memonBin),
    ).rejects.toMatchObject({ stderr: expect.stringContaining('production lint failed') })

    expect(await readFile(path.join(liveDir, 'README.md'), 'utf8')).toBe(originalReadme)
    await expect(readFile(path.join(liveDir, 'results.yaml'), 'utf8')).rejects.toThrow()
    expect(
      JSON.parse(await readFile(path.join(root, '.memon', 'version.json'), 'utf8')),
    ).toHaveProperty('fs_convention_version', 5)
  })

  it('validates approved staged bundles before copying anything into the live project', async () => {
    const root = await fixture()
    const memonBin = await fakeMemon(root, false, true)
    const staging = path.join(root, '.memon', 'migrations', 'v5-to-v6', 'bad-stage')
    const liveDir = path.join(root, 'docs', 'experiments', 'E0001-demo')
    const originalReadme = await readFile(path.join(liveDir, 'README.md'), 'utf8')

    await run(root, 'init', '--project-root', root, '--migration-id', 'bad-stage')
    await run(root, 'approve', '--staging', staging, '--experiment', 'E0001-demo')
    await expect(
      run(root, 'publish', '--staging', staging, '--confirm', 'bad-stage', '--memon-bin', memonBin),
    ).rejects.toMatchObject({ stderr: expect.stringContaining('staged validate failed') })

    expect(await readFile(path.join(liveDir, 'README.md'), 'utf8')).toBe(originalReadme)
    await expect(readFile(path.join(liveDir, 'results.yaml'), 'utf8')).rejects.toThrow()
    await expect(
      readFile(path.join(staging, 'live-backup', 'E0001-demo', 'README.md'), 'utf8'),
    ).rejects.toThrow()
    expect(
      JSON.parse(await readFile(path.join(root, '.memon', 'version.json'), 'utf8')),
    ).toHaveProperty('fs_convention_version', 5)
  })

  it('invalidates approval when a referenced Run README changes', async () => {
    const root = await fixture()
    const runId = 'baseline-260810-120000'
    const runDirectory = path.join(root, 'logs', runId)
    await mkdir(runDirectory, { recursive: true })
    await writeFile(path.join(runDirectory, 'README.md'), '# Run\n\n## Result\n\nPending.\n')
    await writeFile(
      path.join(root, 'docs', 'experiments', 'E0001-demo', 'README.md'),
      `---
id: E0001-demo
slug: demo
runs: [${runId}]
---

## Plan

- [ ] compare variants
`,
    )

    const staging = path.join(root, '.memon', 'migrations', 'v5-to-v6', 'run-change')
    await run(root, 'init', '--project-root', root, '--migration-id', 'run-change')
    await run(root, 'approve', '--staging', staging, '--experiment', 'E0001-demo')
    await writeFile(path.join(runDirectory, 'README.md'), '# Run\n\n## Result\n\nFinished.\n')

    const status = await run(root, 'status', '--staging', staging)
    expect(status.stdout).toContain('E0001-demo\tSTALE')
    await expect(
      run(root, 'approve', '--staging', staging, '--experiment', 'E0001-demo'),
    ).rejects.toMatchObject({
      stderr: expect.stringContaining('start a new staging migration before approval'),
    })
  })

  it('refuses publication when the live Experiment set changes after initialization', async () => {
    const root = await fixture()
    const staging = path.join(root, '.memon', 'migrations', 'v5-to-v6', 'new-experiment')
    await run(root, 'init', '--project-root', root, '--migration-id', 'new-experiment')
    await run(root, 'approve', '--staging', staging, '--experiment', 'E0001-demo')

    const added = path.join(root, 'docs', 'experiments', 'E0002-added')
    await mkdir(added, { recursive: true })
    await writeFile(path.join(added, 'README.md'), '# Added during review\n')

    await expect(run(root, 'verify', '--staging', staging)).rejects.toMatchObject({
      stderr: expect.stringContaining('Experiment set changed after staging; added: E0002-added'),
    })
  })

  it('fails initialization without leaving partial staging when a Run README is missing', async () => {
    const root = await fixture()
    const staging = path.join(root, '.memon', 'migrations', 'v5-to-v6', 'missing-run')
    await writeFile(
      path.join(root, 'docs', 'experiments', 'E0001-demo', 'README.md'),
      `---
id: E0001-demo
slug: demo
runs: [missing-260810-120000]
---
`,
    )

    await expect(
      run(root, 'init', '--project-root', root, '--migration-id', 'missing-run'),
    ).rejects.toMatchObject({ stderr: expect.stringContaining('missing referenced Run README') })
    await expect(readFile(path.join(staging, 'state.yaml'), 'utf8')).rejects.toThrow()
  })
})
