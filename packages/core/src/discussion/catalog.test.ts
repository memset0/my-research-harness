import { symlink } from 'node:fs/promises'
import { createTempProject, removeTempDirs } from '@memon/test-utils'
import { afterEach, describe, expect, it } from 'vitest'
import { rebuildIndex } from '../derived-index/rebuild.js'
import { buildDiscussionCatalog, ProjectCatalogSchema } from '../project-catalogs.js'
import { projectFs as fs } from '../project-file-store.js'

const valid =
  '---\ntitle: Design\nstatus: OPEN\ncategories: [storage]\n---\n\n## Store\n\n```question\nid: STORAGE\ntype: text\ncategory: storage\nstatus: OPEN\n```\n\nBody.\n'
const path = 'docs/discussions/D0001-design/README.md'
afterEach(removeTempDirs)
describe('published discussion catalogs', () => {
  it('publishes portable summaries while retaining invalid questions visibly', async () => {
    const project = await createTempProject({
      files: {
        [path]: valid,
        'docs/discussions/D0002-invalid/README.md': valid.replace('id: STORAGE', 'id: invalid'),
      },
    })
    const built = await buildDiscussionCatalog(project.root)
    expect(built.invalid).toEqual([])
    expect(built.entries).toHaveLength(2)
    expect(built.entries[0]!.summary).toMatchObject({
      title: 'Design',
      questions: [{ id: 'STORAGE', status: 'OPEN', category: 'storage' }],
    })
    expect(built.entries[0]!.summary).not.toHaveProperty('body')
    expect(built.entries[1]!.summary).toMatchObject({
      questions: [{ id: null, status: null }],
      diagnostics: [{ line: 9 }],
    })
    expect(built.warnings?.[0]?.message).toContain('line 9')
  })
  it('rejects duplicate discussions and escaping symlink registrations', async () => {
    const project = await createTempProject({
      files: { [path]: valid, 'docs/discussions/D0001-other/README.md': valid },
    })
    const duplicate = await buildDiscussionCatalog(project.root)
    expect(duplicate.invalid[0]!.message).toContain('duplicate ID D0001')
    const outside = await createTempProject({ files: { 'README.md': valid } })
    await symlink(outside.root, project.path('docs/discussions/D0003-escape'))
    const escaped = await buildDiscussionCatalog(project.root)
    expect(escaped.invalid.some((i) => i.message.includes('escapes'))).toBe(true)
  })
  it('refresh publishes the catalog and reports source-line warnings', async () => {
    const project = await createTempProject({
      files: {
        '.memon/project.yml': 'schema_version: 1\n',
        [path]: valid.replace('id: STORAGE', 'id: invalid'),
      },
    })
    const result = await rebuildIndex(project.root)
    expect(result.status).toBe('rebuilt')
    const catalog = ProjectCatalogSchema.parse(
      JSON.parse(await fs.readFile(project.path('.memon/index/discussions.json'), 'utf8')),
    )
    expect(catalog.kind).toBe('discussions')
    expect(catalog.entries[0]!.id).toBe('D0001')
    expect(
      result.warnings?.some((w) => w.kind === 'discussions' && w.message.includes('line 9')),
    ).toBe(true)
  })
})

it('reports malformed response lines during source refresh without rewriting history', async () => {
  const p = await createTempProject({
    files: { [path]: valid, 'docs/discussions/D0001-design/responses.jsonl': 'not-json\n' },
  })
  const built = await buildDiscussionCatalog(p.root)
  expect(built.warnings).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        resource: 'docs/discussions/D0001-design/responses.jsonl',
        message: expect.stringContaining('line 1:'),
      }),
    ]),
  )
  expect(await fs.readFile(p.path('docs/discussions/D0001-design/responses.jsonl'), 'utf8')).toBe(
    'not-json\n',
  )
})
