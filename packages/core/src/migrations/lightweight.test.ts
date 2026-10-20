import { promises as fs } from 'node:fs'
import { createTempProject, removeTempDirs } from '@memon/test-utils'
import { afterEach, describe, expect, it } from 'vitest'
import { applyLightweightMigration, planLightweightMigration } from './lightweight.js'

afterEach(removeTempDirs)
const id = 'E0001-study'
const run = 'logs/trial-260901-120000'
async function fixture(status = 'FINISHED') {
  return createTempProject({
    experiments: {
      [id]: {
        'README.md': `---\nid: ${id}\nstatus: ACTIVE\ncustom: 'keep this' # comment\nruns: [${run}]\n---\n# Question\nUseful evidence.\n`,
        'experiment.json': JSON.stringify({
          experiment_schema_version: 1,
          variants: [{ id: 'V0001', name: 'Baseline', runs: [run], values: {} }],
          columns: [],
          groups: {},
        }),
      },
    },
    runs: {
      [run]: {
        'README.md': `---\nid: trial-260901-120000\nstatus: ${status}\ncreated_at: 2026-09-01T12:00:00+08:00\n---\nOld execution notes.\n`,
        'result.csv': 'path,stat,value\n$experiment_schema_version,,1\n',
        'native.json': '{"evidence":42}',
      },
    },
  })
}

describe('scoped lightweight migration', () => {
  it('keeps artifacts, original timestamps, aliases and custom frontmatter', async () => {
    const p = await fixture()
    const plan = await planLightweightMigration(p.root, id)
    expect(plan.readme).toContain("custom: 'keep this' # comment")
    expect(plan.readme).not.toContain('runs:')
    await applyLightweightMigration(p.root, plan)
    const target = p.path('logs/E0001/V0001/trial-260901-120000')
    expect(JSON.parse(await fs.readFile(`${target}/run.json`, 'utf8')).created_at).toBe(
      '2026-09-01T12:00:00+08:00',
    )
    expect(JSON.parse(await fs.readFile(`${target}/run.json`, 'utf8'))).toMatchObject({
      active: true,
      legacy_sections: [{ title: 'Preamble', body: 'Old execution notes.\n' }],
    })
    expect(await fs.readFile(p.path(run, 'native.json'), 'utf8')).toBe('{"evidence":42}')
    expect((await fs.lstat(p.path(run))).isSymbolicLink()).toBe(true)
    expect(await fs.readFile(`${target}/result.csv`, 'utf8')).toBe('path,stat,value\n')
    await expect(fs.stat(`${target}/README.md`)).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(fs.stat(p.path('.memon/version.json'))).rejects.toMatchObject({ code: 'ENOENT' })
  })
  it('refuses queued/running Runs and stale plans before moving anything', async () => {
    const busy = await fixture('RUNNING')
    await expect(planLightweightMigration(busy.root, id)).rejects.toThrow(/running or queued/)
    const p = await fixture()
    const plan = await planLightweightMigration(p.root, id)
    await fs.appendFile(p.path(run, 'README.md'), '\nNew evidence\n')
    await expect(applyLightweightMigration(p.root, plan)).rejects.toThrow(/CONFLICT/)
    expect((await fs.lstat(p.path(run))).isDirectory()).toBe(true)
  })
})
