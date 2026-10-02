// Run deprecation: orthogonal to status and archival, idempotent,
// reversible, and excluded from research collections by default.

import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { scanProjectRoot } from '../project-scan/scan.js'
import { parseReadme } from '../readme/parse.js'
import {
  deprecateRun,
  listDeprecatedRunIds,
  RunWriteConflictError,
  undeprecateRun,
} from './deprecation.js'
import { matchesRunDeprecationFilter, RunIndex } from './index.js'
import { readRunDir } from './read.js'

const NOW = '2026-09-08T09:00:00+08:00'

let root: string

function runDoc(id: string, extra: string): string {
  return `---
id: ${id}
name: ${id.replace(/-\d{6}-\d{6}$/, '')}
status: ${extra}
created_at: '2026-09-01T10:00:00+08:00'
command: bash run.sh
---

Free-form notes for ${id}.
`
}

async function writeRun(id: string, status: string, extraLines = ''): Promise<string> {
  const dir = join(root, 'logs', id)
  await mkdir(dir, { recursive: true })
  const content = runDoc(id, `${status}${extraLines}`)
  await writeFile(join(dir, 'README.md'), content, 'utf8')
  return dir
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'memon-deprecation-'))
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

describe('deprecateRun / undeprecateRun', () => {
  it('deprecates a RUNNING run without touching status, artifacts, or the body', async () => {
    const dir = await writeRun('live-260901-100000', 'RUNNING')
    await writeFile(join(dir, 'metrics.csv'), 'step,loss\n1,2\n', 'utf8')
    const before = await readFile(join(dir, 'README.md'), 'utf8')

    const result = await deprecateRun(dir, { now: NOW })

    expect(result).toMatchObject({ prev: false, next: true, noop: false })
    const after = await readFile(join(dir, 'README.md'), 'utf8')
    const parsed = parseReadme(after)
    expect(parsed.frontMatter.deprecated).toBe(true)
    // Status untouched: deprecation is not a kill switch and not a failure.
    expect(parsed.frontMatter.status).toBe('RUNNING')
    expect(parsed.frontMatter.archived).toBe(false)
    expect(parsed.frontMatter.updatedAt).toBe(NOW)
    expect(after).toContain('Free-form notes for live-260901-100000.')
    expect(before.includes('deprecated')).toBe(false)
    // Artifacts are never removed.
    await expect(stat(join(dir, 'metrics.csv'))).resolves.toBeTruthy()
  })

  it('is idempotent and restores the exact original document on undeprecate', async () => {
    const dir = await writeRun('foo-260901-100100', 'FINISHED')
    const original = await readFile(join(dir, 'README.md'), 'utf8')

    await deprecateRun(dir, { now: NOW })
    const again = await deprecateRun(dir, { now: '2026-09-09T09:00:00+08:00' })
    expect(again).toMatchObject({ prev: true, next: true, noop: true })
    // A no-op writes nothing, so `updated_at` keeps the first value.
    expect(parseReadme(await readFile(join(dir, 'README.md'), 'utf8')).frontMatter.updatedAt).toBe(
      NOW,
    )

    const restored = await undeprecateRun(dir, { now: NOW })
    expect(restored).toMatchObject({ prev: true, next: false, noop: false })
    const content = await readFile(join(dir, 'README.md'), 'utf8')
    expect(content).not.toContain('deprecated')
    expect(parseReadme(content).frontMatter.deprecated).toBe(false)
    // Restoration leaves no deprecation residue: the document is the
    // original plus the `updated_at` bump the edit itself recorded.
    expect(content).toBe(
      original.replace('---\n\nFree-form', `updated_at: '${NOW}'\n---\n\nFree-form`),
    )
    expect(await undeprecateRun(dir, { now: NOW })).toMatchObject({ noop: true })
  })

  it('rejects a stale expectedMtime with a CONFLICT error and no write', async () => {
    const dir = await writeRun('bar-260901-100200', 'FAILED')
    const before = await readFile(join(dir, 'README.md'), 'utf8')

    await expect(deprecateRun(dir, { now: NOW, expectedMtime: 1 })).rejects.toBeInstanceOf(
      RunWriteConflictError,
    )
    expect(await readFile(join(dir, 'README.md'), 'utf8')).toBe(before)

    const current = await stat(join(dir, 'README.md'))
    const ok = await deprecateRun(dir, { now: NOW, expectedMtime: current.mtimeMs })
    expect(ok.next).toBe(true)
  })

  it('leaves archival independent', async () => {
    const dir = await writeRun('baz-260901-100300', 'FINISHED\narchived: true')
    await deprecateRun(dir, { now: NOW })

    const run = await readRunDir(dir, 'p')
    expect(run.frontMatter.archived).toBe(true)
    expect(run.frontMatter.deprecated).toBe(true)
  })
})

describe('research collections exclude deprecated runs by default', () => {
  it('scanProjectRoot omits them unless asked, in every execution state', async () => {
    const running = await writeRun('running-260901-100400', 'RUNNING')
    const failed = await writeRun('failed-260901-100500', 'FAILED')
    await writeRun('kept-260901-100600', 'FINISHED')
    await deprecateRun(running, { now: NOW })
    await deprecateRun(failed, { now: NOW })

    const normal = await scanProjectRoot(root)
    expect(normal.scannedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/)
    expect(normal.experiments.map((run) => run.id)).toEqual(['kept-260901-100600'])
    expect(normal.experiments[0]?.deprecated).toBe(false)

    const withDeprecated = await scanProjectRoot(root, { includeDeprecated: true })
    expect(withDeprecated.experiments.map((run) => run.id).sort()).toEqual([
      'failed-260901-100500',
      'kept-260901-100600',
      'running-260901-100400',
    ])

    const onlyDeprecated = await scanProjectRoot(root, { deprecatedOnly: true })
    expect(onlyDeprecated.experiments.map((run) => run.id).sort()).toEqual([
      'failed-260901-100500',
      'running-260901-100400',
    ])
    expect(onlyDeprecated.experiments.every((run) => run.deprecated)).toBe(true)
  })

  it('listDeprecatedRunIds reports the withdrawn ids only', async () => {
    const dir = await writeRun('gone-260901-100700', 'FINISHED')
    await writeRun('here-260901-100800', 'FINISHED')
    await deprecateRun(dir, { now: NOW })

    expect(await listDeprecatedRunIds(root)).toEqual(['logs/gone-260901-100700'])
  })

  it('treats same-basename Runs under different paths as distinct eligibility subjects', async () => {
    const id = 'dup-260901-100900'
    for (const path of [`logs/${id}`, `outputs/${id}`]) {
      await mkdir(join(root, path), { recursive: true })
      await writeFile(join(root, path, 'README.md'), runDoc(id, 'FINISHED'))
    }
    await deprecateRun(join(root, `outputs/${id}`), { now: NOW })

    expect(await listDeprecatedRunIds(root, { ids: [`outputs/${id}`] })).toEqual([`outputs/${id}`])
    expect(await listDeprecatedRunIds(root, { ids: [`logs/${id}`] })).toEqual([])
    // An ambiguous bare id is rejected with its candidate paths, never
    // resolved to whichever directory happens to be walked first.
    await expect(listDeprecatedRunIds(root, { ids: [id] })).rejects.toThrow(
      /Ambiguous Run ID.*logs\/dup-260901-100900.*outputs\/dup-260901-100900|Ambiguous Run ID.*outputs\/dup-260901-100900.*logs\/dup-260901-100900/,
    )
  })

  it('restricts eligibility reads and propagates selected metadata I/O failures', async () => {
    const selected = 'selected-260901-101100'
    const unreadable = 'unreadable-260901-101200'
    await writeRun(selected, 'FINISHED', '\ndeprecated: true')
    const broken = await writeRun(unreadable, 'FINISHED')
    await rm(join(broken, 'README.md'))
    await mkdir(join(broken, 'README.md'))
    expect(await listDeprecatedRunIds(root, { ids: [selected] })).toEqual([selected])
    await expect(listDeprecatedRunIds(root, { ids: [unreadable] })).rejects.toThrow()
  })

  it('does not interpret an invalid deprecation value as eligible evidence', async () => {
    const id = 'invalid-260901-101300'
    await writeRun(id, 'FINISHED', '\ndeprecated: yesterday')
    await expect(listDeprecatedRunIds(root, { ids: [id] })).rejects.toThrow('must be boolean')
  })

  it('RunIndex hides deprecated runs from list/search/count but not from get', async () => {
    const dir = await writeRun('idx-260901-100900', 'FINISHED')
    await writeRun('idx-260901-101000', 'FINISHED')
    await deprecateRun(dir, { now: NOW })
    const index = new RunIndex()
    for (const id of ['idx-260901-100900', 'idx-260901-101000']) {
      index.set(await readRunDir(join(root, 'logs', id), 'p'))
    }

    expect(index.list().map((run) => run.id)).toEqual(['idx-260901-101000'])
    expect(index.count()).toBe(1)
    expect(index.size()).toBe(2)
    expect(index.list({ includeDeprecated: true })).toHaveLength(2)
    expect(index.list({ deprecatedOnly: true }).map((run) => run.id)).toEqual(['idx-260901-100900'])
    expect(index.search('idx').map((run) => run.id)).toEqual(['idx-260901-101000'])
    expect(index.search('idx', 'all', { includeDeprecated: true })).toHaveLength(2)
    // Explicit id lookup still works — nothing is hidden from a direct read.
    expect(index.get('idx-260901-100900')?.frontMatter.deprecated).toBe(true)
    expect(index.has('idx-260901-100900')).toBe(true)
  })

  it('matchesRunDeprecationFilter encodes the default policy', () => {
    expect(matchesRunDeprecationFilter(false)).toBe(true)
    expect(matchesRunDeprecationFilter(true)).toBe(false)
    expect(matchesRunDeprecationFilter(true, { includeDeprecated: true })).toBe(true)
    expect(matchesRunDeprecationFilter(false, { deprecatedOnly: true })).toBe(false)
  })
})
