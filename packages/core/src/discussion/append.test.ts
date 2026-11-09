import { readFile, symlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createTempProject, removeTempDirs } from '@memon/test-utils'
import { afterEach, describe, expect, it } from 'vitest'
import { projectFileContextStorage } from '../project-file-context.js'
import { appendDiscussionLine } from './append.js'

const log = 'docs/discussions/D0001-design/responses.jsonl'
afterEach(removeTempDirs)
describe('guarded discussion append', () => {
  it('creates a missing log and preserves its exact prefix under concurrent appends', async () => {
    const project = await createTempProject({
      files: { 'docs/discussions/D0001-design/README.md': 'Title' },
    })
    await appendDiscussionLine(project.root, log, '{"id":"a"}\n', 0)
    const size = Buffer.byteLength('{"id":"a"}\n')
    const results = await Promise.allSettled([
      appendDiscussionLine(project.root, log, '{"id":"b"}\n', size),
      appendDiscussionLine(project.root, log, '{"id":"c"}\n', size),
    ])
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
    expect(results.filter((r) => r.status === 'rejected')).toHaveLength(1)
    const text = await readFile(join(project.root, log), 'utf8')
    expect(text.startsWith('{"id":"a"}\n')).toBe(true)
    expect(text.trim().split('\n')).toHaveLength(2)
  })
  it('refuses malformed lines, incomplete prefixes and read-only contexts', async () => {
    const project = await createTempProject({ files: { [log]: '{broken' } })
    await expect(appendDiscussionLine(project.root, log, '{}\n', 7)).rejects.toMatchObject({
      code: 'CONFLICT',
    })
    for (const line of ['{}', '{}\n{}\n', 'x\n', `{"a":"${'x'.repeat(4096)}"}\n`])
      await expect(appendDiscussionLine(project.root, log, line, 7)).rejects.toThrow()
    await writeFile(join(project.root, log), '')
    await expect(
      projectFileContextStorage().run(
        { root: project.root, storage: 'local', readOnly: true },
        () => appendDiscussionLine(project.root, log, '{}\n', 0),
      ),
    ).rejects.toMatchObject({ code: 'READ_ONLY' })
    expect(await readFile(join(project.root, log), 'utf8')).toBe('')
  })
  it('uses the scheduled native facade for SSHFS mode while retaining size guards', async () => {
    const project = await createTempProject({ files: { [log]: '' } })
    const run = <T>(work: () => Promise<T>) =>
      projectFileContextStorage().run(
        { root: project.root, storage: 'sshfs', cachePolicy: 'memory', observationPolicy: 'fresh' },
        work,
      )
    await run(() => appendDiscussionLine(project.root, log, '{}\n', 0))
    await expect(
      run(() => appendDiscussionLine(project.root, log, '{}\n', 0)),
    ).rejects.toMatchObject({ code: 'CONFLICT' })
    expect(await readFile(join(project.root, log), 'utf8')).toBe('{}\n')
  })
  it('refuses response-log symlinks outside the allowed discussion scope', async () => {
    const project = await createTempProject({
      files: {
        'docs/discussions/D0001-design/README.md': 'Title',
        'docs/reports/responses.jsonl': '',
      },
    })
    await symlink(project.path('docs/reports/responses.jsonl'), project.path(log))
    await expect(appendDiscussionLine(project.root, log, '{}\n', 0)).rejects.toThrow()
    expect(await readFile(project.path('docs/reports/responses.jsonl'), 'utf8')).toBe('')
  })
  it('rejects final response-log symlinks even when they point to another discussion', async () => {
    const project = await createTempProject({
      files: {
        'docs/discussions/D0001-design/README.md': 'Title',
        'docs/discussions/D0002-other/responses.jsonl': '',
      },
    })
    await symlink(project.path('docs/discussions/D0002-other/responses.jsonl'), project.path(log))
    await expect(appendDiscussionLine(project.root, log, '{}\n', 0)).rejects.toMatchObject({
      code: 'CONFLICT',
    })
    expect(
      await readFile(project.path('docs/discussions/D0002-other/responses.jsonl'), 'utf8'),
    ).toBe('')
  })
})
