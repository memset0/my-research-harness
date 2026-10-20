import { promises as fs } from 'node:fs'
import { createTempProject, removeTempDirs } from '@memon/test-utils'
import { afterEach, describe, expect, it } from 'vitest'
import { withFileWriterLock } from '../file-writer-lock.js'
import { writeFsVersion } from '../fs-version/write.js'
import { createRunMetadata } from '../runs/metadata-mutations.js'
import { rebuildIndex } from './rebuild.js'

afterEach(removeTempDirs)
const time = '2026-10-20T12:00:00+08:00'
async function fixture() {
  const p = await createTempProject()
  await rebuildIndex(p.root, { role: 'cli' })
  await writeFsVersion(p.root, {
    fs_convention_version: 11,
    installed_at: time,
    last_migrated_at: null,
  })
  return p
}

describe('registered writer publication', () => {
  it('retains concurrent serialized creations in the published snapshot', async () => {
    const p = await fixture()
    await Promise.all(
      ['first', 'second'].map((id) =>
        withFileWriterLock(p.root, async () => {
          const result = await createRunMetadata({
            projectRoot: p.root,
            runDir: p.path(`logs/E0001/V0001/${id}`),
            metadata: { id, status: 'PENDING', created_at: time },
            index: { projectRoot: p.root, role: 'cli', publishSnapshot: true },
          })
          expect(result.indexWarnings).toEqual([])
        }),
      ),
    )
    const snapshot = JSON.parse(await fs.readFile(p.path('.memon/index/snapshot.json'), 'utf8'))
    expect(Object.keys(snapshot.runs).sort()).toEqual([
      'logs/E0001/V0001/first',
      'logs/E0001/V0001/second',
    ])
  })
  it('reports saved files with incomplete registration rather than making a partial snapshot', async () => {
    const p = await fixture()
    await fs.rm(p.path('.memon/index/snapshot.json'))
    const result = await createRunMetadata({
      projectRoot: p.root,
      runDir: p.path('logs/E0001/V0001/trial'),
      metadata: { id: 'trial', status: 'PENDING', created_at: time },
      index: { projectRoot: p.root, role: 'cli', publishSnapshot: true },
    })
    expect(result.indexWarnings).toEqual([expect.objectContaining({ incomplete: true })])
    await expect(fs.stat(p.path('logs/E0001/V0001/trial/run.json'))).resolves.toBeTruthy()
    await expect(fs.stat(p.path('.memon/index/snapshot.json'))).rejects.toMatchObject({
      code: 'ENOENT',
    })
  })
})
