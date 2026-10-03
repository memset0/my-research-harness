import { execFileSync } from 'node:child_process'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { MutationError } from '../experiments/mutations.js'
import { resultContentHash } from './result-file.js'
import { writeRunResult } from './writer.js'

let root: string
const RUN = 'logs/a-260901-090000'

beforeEach(async () => {
  root = await fs.realpath(await fs.mkdtemp(join(tmpdir(), 'memon-result-writer-')))
})

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true })
})

async function write(rel: string, content: string) {
  await fs.mkdir(join(root, rel, '..'), { recursive: true })
  await fs.writeFile(join(root, rel), content)
}

async function project(options: { version?: number; owners?: string[]; columns?: unknown[] } = {}) {
  await write(`${RUN}/README.md`, '---\nstatus: FINISHED\n---\n')
  for (const owner of options.owners ?? ['E0001-foo']) {
    await write(
      `docs/experiments/${owner}/README.md`,
      `---\nid: ${owner}\nslug: ${owner.slice(6)}\ntitle: T\nstatus: OPEN\nruns: ["${RUN}"]\n---\n`,
    )
    await write(
      `docs/experiments/${owner}/experiment.json`,
      `${JSON.stringify({
        experiment_schema_version: options.version ?? 1,
        columns: options.columns ?? [
          { path: 'metrics.eval.fid', label: 'FID', type: 'number' },
          { path: 'metrics.eval.clip', label: 'CLIP', type: 'stats', across: 'sample' },
        ],
        variants: [{ id: 'V0001', name: 'x', runs: [RUN] }],
      })}\n`,
    )
  }
}

const read = (rel: string) => fs.readFile(join(root, rel), 'utf8')
const runDir = () => join(root, RUN)
const events = () => fs.readdir(join(root, '.memon/index/events')).catch(() => [] as string[])

describe('writeRunResult', () => {
  it('creates a minimal file with the version row and publishes one index event', async () => {
    await project()
    const result = await writeRunResult({
      projectRoot: root,
      runDir: runDir(),
      set: [{ path: 'metrics.fid', value: 12.3 }],
      index: { projectRoot: root, role: 'cli' },
    })
    expect(result).toMatchObject({
      file: `${RUN}/result.csv`,
      owner: 'E0001-foo',
      created: true,
      changed: true,
      warnings: [],
    })
    expect(await read(`${RUN}/result.csv`)).toBe(
      'path,stat,value\n$experiment_schema_version,,1\nmetrics.fid,,12.3\n',
    )
    expect(result.hash).toBe(resultContentHash(await read(`${RUN}/result.csv`)))
    expect(await events()).toHaveLength(1)
  })

  it('records two statistics as one row each', async () => {
    await project()
    await writeRunResult({
      projectRoot: root,
      runDir: runDir(),
      set: [
        { path: 'metrics.eval.clip', stat: 'mean', value: '0.31' },
        { path: 'metrics.eval.clip', stat: 'std', value: '0.02' },
      ],
    })
    expect(await read(`${RUN}/result.csv`)).toBe(
      'path,stat,value\n$experiment_schema_version,,1\nmetrics.eval.clip,mean,0.31\nmetrics.eval.clip,std,0.02\n',
    )
  })

  it('upserts in place and keeps unrelated rows byte-identical', async () => {
    await project()
    const original =
      'path,stat,value\n$experiment_schema_version,,1\nmetrics.eval.fid,,12.3\n"metrics.eval.is",,40.1\n'
    await write(`${RUN}/result.csv`, original)
    const result = await writeRunResult({
      projectRoot: root,
      runDir: runDir(),
      set: [{ path: 'metrics.eval.fid', value: '11.9' }],
      expectedHash: resultContentHash(original),
      index: { projectRoot: root, role: 'cli' },
    })
    expect(result).toMatchObject({ created: false, replaced: 1, appended: 0 })
    expect(await read(`${RUN}/result.csv`)).toBe(
      'path,stat,value\n$experiment_schema_version,,1\nmetrics.eval.fid,,11.9\n"metrics.eval.is",,40.1\n',
    )
    expect(await events()).toHaveLength(1)
    const unchanged = await writeRunResult({
      projectRoot: root,
      runDir: runDir(),
      set: [{ path: 'metrics.eval.fid', value: '11.9' }],
      index: { projectRoot: root, role: 'cli' },
    })
    expect(unchanged.changed).toBe(false)
    expect(await events()).toHaveLength(1)
  })

  it('validates every value before writing anything', async () => {
    await project()
    const attempt = writeRunResult({
      projectRoot: root,
      runDir: runDir(),
      set: [
        { path: 'metrics.ok', value: 1 },
        { path: 'metrics.eval.fid', value: 'abc' },
        { path: 'metrics.eval.clip', value: '0.3' },
        { path: 'metrics.x', stat: 'median', value: '1' },
        { path: '$experiment_schema_version', value: '9' },
        { path: 'outputs.fid', value: '1' },
      ],
    })
    await expect(attempt).rejects.toMatchObject({
      code: 'BAD_REQUEST',
      reason: 'RESULT_VALUE_INVALID',
      details: { problems: expect.arrayContaining([expect.stringContaining('metrics.eval.fid')]) },
    })
    const error = (await attempt.catch((caught) => caught)) as MutationError
    expect((error.details.problems as string[]).length).toBe(5)
    await expect(fs.access(join(root, RUN, 'result.csv'))).rejects.toThrow()
  })

  it('refuses an orphan Run without creating a file', async () => {
    await write(`${RUN}/README.md`, '---\nstatus: FINISHED\n---\n')
    await expect(
      writeRunResult({
        projectRoot: root,
        runDir: runDir(),
        set: [{ path: 'metrics.fid', value: 1 }],
      }),
    ).rejects.toMatchObject({
      code: 'BAD_STATE',
      reason: 'RESULT_OWNER_MISSING',
      message: expect.stringContaining('memon experiment link'),
    })
    await expect(fs.access(join(root, RUN, 'result.csv'))).rejects.toThrow()
  })

  it('refuses a Run declared by two Experiments', async () => {
    await project({ owners: ['E0001-foo', 'E0002-bar'] })
    await expect(
      writeRunResult({
        projectRoot: root,
        runDir: runDir(),
        set: [{ path: 'metrics.fid', value: 1 }],
      }),
    ).rejects.toMatchObject({ code: 'BAD_STATE', reason: 'RESULT_OWNER_AMBIGUOUS' })
  })

  it('refuses a stale version with the upgrade command and leaves the file unchanged', async () => {
    await project({ version: 2 })
    const original = 'path,stat,value\n$experiment_schema_version,,1\nmetrics.fid,,1\n'
    await write(`${RUN}/result.csv`, original)
    await expect(
      writeRunResult({
        projectRoot: root,
        runDir: runDir(),
        set: [{ path: 'metrics.fid', value: 2 }],
      }),
    ).rejects.toMatchObject({
      code: 'BAD_STATE',
      reason: 'RESULT_SCHEMA_MISMATCH',
      details: {
        recorded: 1,
        expected: 2,
        upgradeCommand: 'memon experiment schema upgrade E0001-foo --to 2',
      },
    })
    expect(await read(`${RUN}/result.csv`)).toBe(original)
  })

  it('refuses a stale expected hash with CONFLICT and writes nothing', async () => {
    await project()
    const original = 'path,stat,value\n$experiment_schema_version,,1\nmetrics.fid,,1\n'
    await write(`${RUN}/result.csv`, original)
    await expect(
      writeRunResult({
        projectRoot: root,
        runDir: runDir(),
        set: [{ path: 'metrics.fid', value: 2 }],
        expectedHash: 'deadbeef',
      }),
    ).rejects.toMatchObject({ code: 'CONFLICT' })
    expect(await read(`${RUN}/result.csv`)).toBe(original)
  })

  it('unsets a pair', async () => {
    await project()
    await write(
      `${RUN}/result.csv`,
      'path,stat,value\n$experiment_schema_version,,1\nmetrics.a,,1\nmetrics.b,,2\n',
    )
    const result = await writeRunResult({
      projectRoot: root,
      runDir: runDir(),
      unset: [{ path: 'metrics.a' }],
    })
    expect(result.removed).toBe(1)
    expect(await read(`${RUN}/result.csv`)).toBe(
      'path,stat,value\n$experiment_schema_version,,1\nmetrics.b,,2\n',
    )
  })

  it('writes an ignored new file with RESULT_FILE_IGNORED and leaves .gitignore unchanged', async () => {
    await project()
    const gitignore = 'logs/*/*\n!logs/*/README.md\n'
    await write('.gitignore', gitignore)
    execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: root })
    const result = await writeRunResult({
      projectRoot: root,
      runDir: runDir(),
      set: [{ path: 'metrics.eval.fid', value: '12.3' }],
    })
    expect(result.created).toBe(true)
    expect(result.warnings).toMatchObject([
      {
        code: 'RESULT_FILE_IGNORED',
        severity: 'warning',
        details: { rule: '.gitignore:1:logs/*/*', target: '.gitignore' },
      },
    ])
    expect(await read('.gitignore')).toBe(gitignore)
    expect(await read(`${RUN}/result.csv`)).toContain('metrics.eval.fid,,12.3')
  })

  it('writes a symlinked Run at its real path and warns about the real file', async () => {
    await project()
    await fs.rename(join(root, RUN), join(root, 'logs/a-20260901-090000'))
    await fs.symlink('a-20260901-090000', join(root, RUN))
    await write('.gitignore', 'logs/*/*\n!logs/*/README.md\n')
    execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: root })
    const result = await writeRunResult({
      projectRoot: root,
      runDir: runDir(),
      set: [{ path: 'metrics.eval.fid', value: '12.3' }],
    })
    expect(result.warnings).toMatchObject([
      {
        code: 'RESULT_FILE_IGNORED',
        details: { file: 'logs/a-20260901-090000/result.csv', target: '.gitignore' },
      },
    ])
    expect(await read('logs/a-20260901-090000/result.csv')).toContain('metrics.eval.fid,,12.3')
  })

  it('refuses a symlinked Run whose target leaves the project', async () => {
    await project()
    const outside = await fs.realpath(await fs.mkdtemp(join(tmpdir(), 'memon-result-outside-')))
    try {
      await fs.rename(join(root, RUN), join(outside, 'run'))
      await fs.symlink(join(outside, 'run'), join(root, RUN))
      const error = (await writeRunResult({
        projectRoot: root,
        runDir: runDir(),
        set: [{ path: 'metrics.fid', value: 1 }],
      }).catch((caught) => caught)) as MutationError
      expect(error).toMatchObject({ code: 'BAD_STATE', reason: 'RUN_PATH_OUTSIDE_PROJECT' })
      await expect(fs.access(join(outside, 'run', 'result.csv'))).rejects.toThrow()
    } finally {
      await fs.rm(outside, { recursive: true, force: true })
    }
  })

  it('makes no ignore check outside Git', async () => {
    await project()
    await write('.gitignore', 'logs/\n')
    const result = await writeRunResult({
      projectRoot: root,
      runDir: runDir(),
      set: [{ path: 'metrics.fid', value: 1 }],
    })
    expect(result.warnings).toEqual([])
  })
})
