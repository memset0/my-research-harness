import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { isRunPath, resolveDeclaredRunPath, resolveRunReference } from './run-path.js'
import { projectFs } from '../project-file-store.js'

const roots: string[] = []
const name = 'trial-260908-120000'

afterEach(async () => {
  vi.restoreAllMocks()
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })))
})

async function fixture() {
  const root = await fs.mkdtemp(join(tmpdir(), 'memon-run-path-'))
  roots.push(root)
  await fs.mkdir(join(root, 'logs', name), { recursive: true })
  await fs.writeFile(join(root, 'logs', name, 'README.md'), '---\ndeprecated: true\n---\n')
  return root
}

describe('project-relative Run references', () => {
  it.each([
    '../logs/x-260908-120000',
    '/logs/x-260908-120000',
    'logs/../x-260908-120000',
    'logs//x-260908-120000',
    'logs\\x-260908-120000',
    'logs/%2f-260908-120000',
  ])('rejects unsafe %s', (path) => {
    expect(isRunPath(path)).toBe(false)
  })

  it('resolves a declared member without directory discovery', async () => {
    const root = await fixture()
    const scan = vi.spyOn(projectFs, 'readdir')
    expect(await resolveDeclaredRunPath(root, `logs/${name}`)).toBe(join(root, 'logs', name))
    expect(scan).not.toHaveBeenCalled()
  })

  it('rejects duplicate bare IDs but resolves either explicit path', async () => {
    const root = await fixture()
    await fs.mkdir(join(root, 'outputs', name), { recursive: true })
    const project = { root, name: 'test', include: [], exclude: [] }
    await expect(resolveRunReference(project, name)).rejects.toThrow('Ambiguous')
    expect(await resolveRunReference(project, `outputs/${name}`)).toBe(join(root, 'outputs', name))
  })

  it('rejects a README symlink escaping the project', async () => {
    const root = await fixture()
    const outside = await fs.mkdtemp(join(tmpdir(), 'memon-outside-'))
    roots.push(outside)
    await fs.writeFile(join(outside, 'README.md'), 'private')
    await fs.unlink(join(root, 'logs', name, 'README.md'))
    await fs.symlink(join(outside, 'README.md'), join(root, 'logs', name, 'README.md'))
    await expect(resolveDeclaredRunPath(root, `logs/${name}`)).rejects.toThrow('escapes')
  })
})
