// Backend half of the cross-surface byte-identity check: the shared parity
// sequence driven through `FilesystemMutationService` (the service central
// and standalone Web both call) must write exactly the golden tree in
// `@memon/core`'s `test-fixtures/mutation-parity/expected`. The CLI runs the
// same sequence against the same fixture, so both surfaces write identical
// bytes for the same inputs and clock.

import { createHash } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { formatIsoLocal } from '@memon/core'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { FilesystemMutationService } from './mutation-service.js'

const FIXTURE = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../core/test-fixtures/mutation-parity',
)
const CLOCK = new Date('2026-09-02T03:04:05Z')

let root: string
beforeEach(async () => {
  root = await fs.mkdtemp(join(tmpdir(), 'memon-backend-parity-'))
  await fs.cp(join(FIXTURE, 'seed'), root, { recursive: true })
})
afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true })
})

async function tree(dir: string): Promise<Record<string, string>> {
  const out: Record<string, string> = {}
  async function walk(current: string) {
    for (const entry of await fs.readdir(current, { withFileTypes: true })) {
      const path = join(current, entry.name)
      const rel = relative(dir, path).split(sep).join('/')
      if (rel === '.memon' || rel === 'docs/journal.md') continue
      if (entry.isDirectory()) await walk(path)
      else out[rel] = await fs.readFile(path, 'utf8')
    }
  }
  await walk(dir)
  return out
}

async function lock(rel: string) {
  const path = join(root, rel)
  const [content, stat] = await Promise.all([fs.readFile(path, 'utf8'), fs.stat(path)])
  return {
    expectedMtime: stat.mtimeMs,
    expectedHash: createHash('sha1').update(content).digest('hex'),
  }
}

describe('Backend mutation parity', () => {
  it('writes the shared golden tree byte-for-byte', async () => {
    const service = new FilesystemMutationService(
      [{ name: 'project-a', root, include: [], exclude: [] }],
      () => CLOCK,
    )
    await service.createExperiment('project-a', { slug: 'parity-plain', title: 'Parity plain' })
    const probeLock = await lock('logs/probe-260901-120000/README.md')
    await service.createExperiment('project-a', {
      slug: 'parity-imported',
      fromRun: 'probe-260901-120000',
      fromRunExpectedMtime: probeLock.expectedMtime,
      fromRunExpectedHash: probeLock.expectedHash,
    })
    const experimentLock = await lock('docs/experiments/E0001-parity-plain/README.md')
    const runLock = await lock('logs/other-260901-130000/README.md')
    await service.bindExperiment('link', 'project-a', 'E0001-parity-plain', {
      run: 'other-260901-130000',
      ...experimentLock,
      expectedRunMtime: runLock.expectedMtime,
      expectedRunHash: runLock.expectedHash,
    })
    await service.setExperimentStatus('project-a', 'E0001-parity-plain', {
      status: 'RESOLVED',
      ...(await lock('docs/experiments/E0001-parity-plain/README.md')),
    })
    await service.setRunStatus('project-a', 'probe-260901-120000', {
      status: 'FINISHED',
      ...(await lock('logs/probe-260901-120000/README.md')),
    })

    const stamp = formatIsoLocal(CLOCK)
    const expected = Object.fromEntries(
      Object.entries(await tree(join(FIXTURE, 'expected'))).map(([path, body]) => [
        path,
        body.replaceAll('{{NOW}}', stamp),
      ]),
    )
    expect(await tree(root)).toEqual(expected)
  })
})
