import { execFile } from 'node:child_process'
import { promises as fs } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { createTempProject, removeTempDirs } from '@memon/test-utils'
import { afterEach, expect, it } from 'vitest'

const execute = promisify(execFile)
afterEach(removeTempDirs)

async function script(name: string, root: string, ...args: string[]) {
  const file = fileURLToPath(new URL(`../../migrations/scripts/${name}.mjs`, import.meta.url))
  const result = await execute(process.execPath, [file, '--project-root', root, ...args], {
    env: { ...process.env, TZ: 'Asia/Shanghai' },
  })
  return JSON.parse(result.stdout)
}

async function experiment(status = 'FINISHED') {
  return createTempProject({
    files: {
      '.memon/project.yml':
        'schema_version: 1\nrun_dirs: ["logs/*", "logs/E????/V????/*", "logs/E????/smoke/*"]\n',
    },
    experiments: {
      'E0001-study': {
        'README.md':
          '---\nid: E0001-study\nstatus: ACTIVE\nruns: [logs/trial-260901-120000]\n---\n# Research\nEvidence remains useful.\n',
        'experiment.json': JSON.stringify({
          experiment_schema_version: 1,
          variants: [
            { id: 'V0001', name: 'Baseline', runs: ['logs/trial-260901-120000'], values: {} },
          ],
          columns: [],
          groups: {},
        }),
      },
    },
    runs: {
      'logs/trial-260901-120000': {
        'README.md': `---\nid: trial-260901-120000\nstatus: ${status}\ncreated_at: '2026-09-01T12:00:00+08:00'\n---\n`,
        'result.csv': 'path,stat,value\n$experiment_schema_version,,1\n',
        'native.json': '{"value":42}',
      },
    },
  })
}

it('plans and applies one experiment through the script, retaining native files, times and aliases', async () => {
  const project = await experiment()
  const plan = await script('v10-to-v11', project.root, '--experiment', 'E0001')
  const source = project.path('logs/trial-260901-120000')
  expect((await fs.lstat(source)).isDirectory()).toBe(true)
  await fs.writeFile(project.path('plan.json'), JSON.stringify(plan))
  const applied = await script(
    'v10-to-v11',
    project.root,
    '--experiment',
    'E0001',
    '--apply',
    project.path('plan.json'),
  )
  expect(applied).toMatchObject({ ok: true, markerChanged: false, index: 'rebuilt' })
  expect((await fs.lstat(source)).isSymbolicLink()).toBe(true)
  expect(await fs.readFile(`${source}/native.json`, 'utf8')).toBe('{"value":42}')
  expect(JSON.parse(await fs.readFile(`${source}/run.json`, 'utf8')).created_at).toBe(
    '2026-09-01T12:00:00+08:00',
  )
  await expect(fs.stat(project.path('.memon/version.json'))).rejects.toMatchObject({
    code: 'ENOENT',
  })
})

it('refuses stale plans and busy executions without moving source data', async () => {
  const project = await experiment()
  const plan = await script('v10-to-v11', project.root, '--experiment', 'E0001')
  await fs.writeFile(project.path('plan.json'), JSON.stringify(plan))
  await fs.appendFile(project.path('docs/experiments/E0001-study/README.md'), 'Changed\n')
  await expect(
    script(
      'v10-to-v11',
      project.root,
      '--experiment',
      'E0001',
      '--apply',
      project.path('plan.json'),
    ),
  ).rejects.toMatchObject({ stderr: expect.stringContaining('CONFLICT') })
  expect((await fs.lstat(project.path('logs/trial-260901-120000'))).isDirectory()).toBe(true)
  const busy = await experiment('RUNNING')
  await expect(script('v10-to-v11', busy.root, '--experiment', 'E0001')).rejects.toMatchObject({
    stderr: expect.stringContaining('running or queued'),
  })
})

const report =
  '---\nid: R0001\ntitle: Findings\ncreated_at: "2026-09-01T12:00:00+08:00"\ncustom: keep\n---\n# Findings\nEvidence from E0001.\n'

it('previews a Report without writes and preserves metadata, assets, backup and old links on apply', async () => {
  const project = await createTempProject({
    files: {
      'docs/reports/R0001-study/README.md': report,
      'docs/reports/R0001-study/data/value.csv': 'x\n42\n',
    },
  })
  const args = ['--report', 'R0001', '--kind', 'finding']
  const plan = await script('reports-to-wiki', project.root, ...args)
  expect(plan.applied).toBe(false)
  await expect(fs.stat(project.path('.memon'))).rejects.toMatchObject({ code: 'ENOENT' })
  const applied = await script(
    'reports-to-wiki',
    project.root,
    ...args,
    '--expected-hash',
    plan.sourceHash,
    '--apply',
  )
  const migrated = await fs.readFile(project.path(applied.newPath), 'utf8')
  expect(migrated).toContain('legacy_id: R0001')
  expect(migrated).toContain('custom: keep')
  expect(migrated).toContain('2026-09-01T12:00:00+08:00')
  expect(migrated).toContain('- E0001')
  expect(
    await fs.readFile(project.path('docs/wiki/finding/W0001-study/data/value.csv'), 'utf8'),
  ).toBe('x\n42\n')
  expect((await fs.lstat(project.path('docs/reports/R0001-study'))).isSymbolicLink()).toBe(true)
  expect(await fs.readFile(project.path(applied.backup, 'source/README.md'), 'utf8')).toBe(report)
  expect(await fs.readFile(project.path('docs/reports/R0001-study/data/value.csv'), 'utf8')).toBe(
    'x\n42\n',
  )
})

it('rejects a changed Report and invalid conversion before removing the source', async () => {
  const project = await createTempProject({ files: { 'docs/reports/R0001-study.md': report } })
  const args = ['--report', 'R0001', '--kind', 'note']
  const plan = await script('reports-to-wiki', project.root, ...args)
  await fs.appendFile(project.path('docs/reports/R0001-study.md'), 'new evidence\n')
  await expect(
    script('reports-to-wiki', project.root, ...args, '--expected-hash', plan.sourceHash, '--apply'),
  ).rejects.toMatchObject({ stderr: expect.stringContaining('CONFLICT') })
  await fs.writeFile(
    project.path('docs/reports/R0001-study.md'),
    report.replace('Evidence from E0001.', 'No sources.'),
  )
  await expect(
    script('reports-to-wiki', project.root, '--report', 'R0001', '--kind', 'finding', '--apply'),
  ).rejects.toMatchObject({ stderr: expect.stringContaining('WIKI_SOURCES_REQUIRED') })
  expect((await fs.lstat(project.path('docs/reports/R0001-study.md'))).isFile()).toBe(true)
})

it('requires an evidence-based creation time instead of inferring it from checkout mtime', async () => {
  const project = await createTempProject({
    files: { 'docs/reports/R0001-study.md': '# Findings\nText.\n' },
  })
  const args = ['--report', 'R0001', '--kind', 'note']
  await expect(script('reports-to-wiki', project.root, ...args, '--apply')).rejects.toMatchObject({
    stderr: expect.stringContaining('--created-at'),
  })
  const result = await script(
    'reports-to-wiki',
    project.root,
    ...args,
    '--created-at',
    '2026-01-01T10:00:00+08:00',
    '--apply',
  )
  expect(await fs.readFile(project.path(result.newPath), 'utf8')).toContain(
    '2026-01-01T10:00:00+08:00',
  )
})

it.skipIf(process.getuid?.() === 0)(
  'removes its new target when source archival fails after copying',
  async () => {
    const project = await createTempProject({ files: { 'docs/reports/R0001-study.md': report } })
    const directory = project.path('docs/reports')
    await fs.chmod(directory, 0o555)
    try {
      await expect(
        script('reports-to-wiki', project.root, '--report', 'R0001', '--kind', 'note', '--apply'),
      ).rejects.toBeDefined()
      expect(await fs.readFile(project.path('docs/reports/R0001-study.md'), 'utf8')).toBe(report)
      await expect(fs.stat(project.path('docs/wiki/note/W0001-study.md'))).rejects.toMatchObject({
        code: 'ENOENT',
      })
    } finally {
      await fs.chmod(directory, 0o755)
    }
  },
)

it('refuses Report assets escaping the project root', async () => {
  const project = await createTempProject({
    files: { 'docs/reports/R0001-study/README.md': report },
  })
  const other = await createTempProject({ files: { 'private.txt': 'untouched' } })
  await fs.symlink(other.path('private.txt'), project.path('docs/reports/R0001-study/escape'))
  await expect(
    script('reports-to-wiki', project.root, '--report', 'R0001', '--kind', 'note', '--apply'),
  ).rejects.toBeDefined()
  expect(await fs.readFile(other.path('private.txt'), 'utf8')).toBe('untouched')
  expect((await fs.lstat(project.path('docs/reports/R0001-study'))).isDirectory()).toBe(true)
})

it('preserves contained asset symlinks when the bundle changes depth', async () => {
  const project = await createTempProject({
    files: { 'docs/reports/R0001-study/README.md': report, 'docs/shared.csv': 'evidence\n' },
  })
  await fs.symlink('../../shared.csv', project.path('docs/reports/R0001-study/data.csv'))
  const result = await script(
    'reports-to-wiki',
    project.root,
    '--report',
    'R0001',
    '--kind',
    'note',
    '--apply',
  )
  expect(result.applied).toBe(true)
  expect(await fs.readFile(project.path('docs/wiki/note/W0001-study/data.csv'), 'utf8')).toBe(
    'evidence\n',
  )
  expect(await fs.readFile(project.path('docs/reports/R0001-study/data.csv'), 'utf8')).toBe(
    'evidence\n',
  )
})

it('reads intermediate v6 sidecars without requiring removed public validation commands', async () => {
  const project = await createTempProject({
    experiments: {
      'E0001-study': {
        'README.md':
          '---\nid: E0001-study\nslug: study\ntitle: Study\nstatus: OPEN\ncreated_at: 2026-09-01T12:00:00+08:00\nupdated_at: 2026-09-01T12:00:00+08:00\n---\n# Study\n',
        'implementation.yaml': 'schema_version: 1\nitems: []\n',
        'investigation.yaml': 'schema_version: 1\nitems: []\n',
        'results.yaml': 'schema_version: 1\ncolumns: []\nvariants: []\n',
      },
    },
  })
  expect(await script('inspect', project.root, '--experiment', 'E0001')).toMatchObject({ ok: true })
  await fs.writeFile(
    project.path('docs/experiments/E0001-study/results.yaml'),
    'schema_version: wrong\n',
  )
  expect(
    await script('inspect', project.root, '--experiment', 'E0001').catch(() => null),
  ).toBeNull()
})

it('provides historical schema normalization as a migration script', async () => {
  const project = await experiment()
  expect(
    await script('experiment-schema', project.root, '--experiment', 'E0001', '--to', '1'),
  ).toMatchObject({ ok: true, applied: false })
  expect(
    await script(
      'experiment-schema',
      project.root,
      '--experiment',
      'E0001',
      '--to',
      '1',
      '--apply',
    ),
  ).toMatchObject({ ok: true, applied: false })
  await expect(
    script('experiment-schema', project.root, '--experiment', 'E0001', '--to', 'zero', '--apply'),
  ).rejects.toBeDefined()
  expect((await fs.lstat(project.path('logs/trial-260901-120000'))).isDirectory()).toBe(true)
})
