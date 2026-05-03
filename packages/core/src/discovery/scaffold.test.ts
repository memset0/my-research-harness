import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { parseJournal } from '../journal/parse.js'
import { parseReadme } from '../readme/parse.js'
import { ExperimentExistsError, createExperimentScaffold } from './scaffold.js'

let root: string

beforeEach(async () => {
  root = await fs.mkdtemp(join(tmpdir(), 'memon-scaffold-'))
})

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true })
})

describe('createExperimentScaffold', () => {
  it('creates directory + README + run.sh + JOURNAL [CREATE]', async () => {
    const fixedNow = new Date(2026, 4, 3, 8, 28, 0) // May 3 2026 08:28:00 local
    const result = await createExperimentScaffold({
      projectRoot: root,
      projectName: 'test-proj',
      name: 'foo',
      now: fixedNow,
    })

    expect(result.id).toBe('foo-260503-082800')
    expect(result.path).toBe(join(root, 'logs', 'foo-260503-082800'))

    const readmeContent = await fs.readFile(join(result.path, 'README.md'), 'utf8')
    const parsed = parseReadme(readmeContent)
    expect(parsed.parseErrors).toEqual([])
    expect(parsed.frontMatter.id).toBe('foo-260503-082800')
    expect(parsed.frontMatter.project).toBe('test-proj')
    expect(parsed.frontMatter.status).toBe('PENDING')
    expect(parsed.frontMatter.entry).toBe('./run.sh')

    const runSh = await fs.readFile(join(result.path, 'run.sh'), 'utf8')
    expect(runSh).toContain('foo-260503-082800')

    const journal = await fs.readFile(join(root, 'JOURNAL.md'), 'utf8')
    const journalParsed = parseJournal(journal)
    expect(journalParsed.events).toHaveLength(1)
    expect(journalParsed.events[0]!.tag).toBe('CREATE')
    expect(journalParsed.events[0]!.experimentId).toBe('foo-260503-082800')
  })

  it('throws ExperimentExistsError on collision', async () => {
    const fixedNow = new Date(2026, 4, 3, 8, 28, 0)
    await createExperimentScaffold({
      projectRoot: root,
      projectName: 'p',
      name: 'foo',
      now: fixedNow,
    })

    await expect(
      createExperimentScaffold({ projectRoot: root, projectName: 'p', name: 'foo', now: fixedNow }),
    ).rejects.toBeInstanceOf(ExperimentExistsError)
  })

  it('skips JOURNAL append when appendJournal=false', async () => {
    const fixedNow = new Date(2026, 4, 3, 8, 28, 0)
    await createExperimentScaffold({
      projectRoot: root,
      projectName: 'p',
      name: 'foo',
      now: fixedNow,
      appendJournal: false,
    })

    await expect(fs.access(join(root, 'JOURNAL.md'))).rejects.toThrow()
  })
})
