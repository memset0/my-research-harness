// `--run-depth` plumbing: the parsed global flag bounds every CLI Run walk,
// while project-relative Run paths keep resolving directly.

import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spyExit } from '@memon/test-utils'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { runResolveExp } from '../commands/run-resolve-exp.js'
import { runScan } from '../commands/scan.js'
import { parseRunDepth, runWalkOptions, setRunDepth } from './discovery-options.js'

const readme = (id: string) =>
  `---\nid: ${id}\nname: x\nstatus: FINISHED\ncreated_at: '2026-09-01T09:00:00+08:00'\nupdated_at: '2026-09-01T09:00:00+08:00'\n---\n`

let root: string
let stdout: string[]
let realWrite: typeof process.stdout.write

beforeEach(async () => {
  root = await fs.mkdtemp(join(tmpdir(), 'memon-run-depth-cli-'))
  for (const dir of ['logs/top-260901-090000', 'outputs/group/deep-260901-100000']) {
    await fs.mkdir(join(root, dir), { recursive: true })
    await fs.writeFile(join(root, dir, 'README.md'), readme(dir.split('/').pop()!))
  }
  await fs.mkdir(join(root, 'docs/experiments/E0001-deep'), { recursive: true })
  await fs.writeFile(
    join(root, 'docs/experiments/E0001-deep/README.md'),
    '---\nid: E0001-deep\nslug: deep\nruns: [outputs/group/deep-260901-100000]\n---\n',
  )
  stdout = []
  realWrite = process.stdout.write.bind(process.stdout)
  process.stdout.write = ((chunk: unknown) => {
    stdout.push(String(chunk))
    return true
  }) as typeof process.stdout.write
})

afterEach(async () => {
  process.stdout.write = realWrite
  setRunDepth(undefined)
  await fs.rm(root, { recursive: true, force: true })
})

describe('--run-depth', () => {
  it('accepts only 1 and 2', () => {
    expect(parseRunDepth(undefined)).toBeUndefined()
    expect(parseRunDepth('1')).toBe(1)
    expect(parseRunDepth('2')).toBe(2)
    for (const raw of ['0', '3', 'two', '1.0', '']) expect(parseRunDepth(raw)).toBeNull()
  })

  it('leaves walks unbounded when unset', async () => {
    expect(runWalkOptions()).toEqual({})
    await runScan({ projectRoot: root, format: 'json' })
    const ids = JSON.parse(stdout.join('')).experiments.map((run: { id: string }) => run.id)
    expect(ids.sort()).toEqual(['deep-260901-100000', 'top-260901-090000'])
  })

  it('bounds memon scan', async () => {
    setRunDepth(1)
    await runScan({ projectRoot: root, format: 'json' })
    const ids = JSON.parse(stdout.join('')).experiments.map((run: { id: string }) => run.id)
    expect(ids).toEqual(['top-260901-090000'])
  })

  it('resolves a path target beyond the bound but not its bare base name', async () => {
    setRunDepth(1)
    await runResolveExp({
      projectRoot: root,
      cwd: root,
      runIdOrDir: 'outputs/group/deep-260901-100000',
    })
    expect(stdout.join('')).toBe('E0001-deep\n')

    const exit = spyExit()
    try {
      await runResolveExp({ projectRoot: root, cwd: root, runIdOrDir: 'deep-260901-100000' }).catch(
        () => undefined,
      )
      expect(exit.code).not.toBeNull()
    } finally {
      exit.restore()
    }
  })
})
