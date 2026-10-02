import { execFileSync } from 'node:child_process'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { readExperimentDoc } from '../experiments/discover.js'
import { buildExperimentBundle } from '../experiments/mutations.js'
import { lintExperimentBundle } from './bundle-lint.js'

let root: string
const A = 'logs/a-260901-090000'
const B = 'logs/b-260901-090000'

beforeEach(async () => {
  root = await fs.realpath(await fs.mkdtemp(join(tmpdir(), 'memon-bundle-lint-')))
})

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true })
})

async function write(rel: string, content: string) {
  await fs.mkdir(join(root, rel, '..'), { recursive: true })
  await fs.writeFile(join(root, rel), content)
}

async function project() {
  const bundle = buildExperimentBundle({
    id: 'E0001-foo',
    slug: 'foo',
    timestamp: '2026-10-02T12:00:00+08:00',
  })
  const readme = bundle['README.md'].replace('runs: []', `runs: ["${A}", "${B}"]`)
  await write('docs/experiments/E0001-foo/README.md', readme)
  await write('docs/experiments/E0001-foo/implementation.yaml', bundle['implementation.yaml'])
  await write('docs/experiments/E0001-foo/investigation.yaml', bundle['investigation.yaml'])
  await write(
    'docs/experiments/E0001-foo/experiment.json',
    `${JSON.stringify({
      experiment_schema_version: 1,
      columns: [{ path: 'metrics.fid', label: 'FID', type: 'number' }],
      variants: [{ id: 'V0001', name: 'x', runs: [A, B] }],
    })}\n`,
  )
  for (const run of [A, B]) await write(`${run}/README.md`, '---\nstatus: FINISHED\n---\n')
  await write(
    `${A}/result.csv`,
    'path,stat,value\n$experiment_schema_version,,1\nmetrics.fid,,abc\n',
  )
  await write(
    `${B}/result.csv`,
    'path,stat,value\n$experiment_schema_version,,2\nmetrics.fid,mean,1\n',
  )
}

async function lint() {
  const experiment = await readExperimentDoc(root, 'p', 'E0001-foo')
  return lintExperimentBundle(root, experiment!, { runDirs: ['logs/*'] })
}

describe('lintExperimentBundle', () => {
  it('reports declared-type, version and cross-file problems of member result files', async () => {
    await project()
    const codes = (await lint()).map((diagnostic) => [diagnostic.code, diagnostic.file])
    expect(codes).toEqual([
      ['RESULT_VALUE_TYPE_MISMATCH', `${A}/result.csv`],
      ['RESULT_SCHEMA_MISMATCH', `${B}/result.csv`],
      ['RESULT_STAT_ON_SCALAR', `${B}/result.csv`],
      ['RESULT_TYPE_CONFLICT', `${B}/result.csv`],
    ])
  })

  it('warns about existing member result files the ignore rules exclude, only inside Git', async () => {
    await project()
    await write(
      `${A}/result.csv`,
      'path,stat,value\n$experiment_schema_version,,1\nmetrics.fid,,1\n',
    )
    await write(
      `${B}/result.csv`,
      'path,stat,value\n$experiment_schema_version,,1\nmetrics.fid,,2\n',
    )
    expect(await lint()).toEqual([])
    await write('.gitignore', 'logs/*/*\n!logs/*/README.md\n')
    execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: root })
    const diagnostics = await lint()
    expect(
      diagnostics.map((diagnostic) => [diagnostic.code, diagnostic.severity, diagnostic.file]),
    ).toEqual([
      ['RESULT_FILE_IGNORED', 'warning', `${A}/result.csv`],
      ['RESULT_FILE_IGNORED', 'warning', `${B}/result.csv`],
    ])
    expect(diagnostics[0]!.message).toContain("'!/logs/*/result.csv' >> '.gitignore'")
    expect(await fs.readFile(join(root, '.gitignore'), 'utf8')).toBe(
      'logs/*/*\n!logs/*/README.md\n',
    )
  })
})
