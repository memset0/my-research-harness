import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { projectFs } from '@memon/core'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PathContainmentError, resolveContained } from './containment.js'
import { withRequestScope } from './request-scope.js'
import { resolveRunPath, resolveRunReferencePath } from './run-path.js'

const roots: string[] = []

afterEach(async () => {
  vi.restoreAllMocks()
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })))
})

async function projectWithRuns(count: number) {
  const root = await fs.mkdtemp(join(tmpdir(), 'memon-request-scope-'))
  roots.push(root)
  const runs: string[] = []
  for (let index = 0; index < count; index++) {
    const run = `logs/r${index}-260101-00000${index}`
    await fs.mkdir(join(root, run), { recursive: true })
    await fs.writeFile(join(root, run, 'README.md'), '---\nstatus: FINISHED\n---\n')
    runs.push(run)
  }
  return { root, runs }
}

function rootRealpaths(spy: { mock: { calls: unknown[][] } }, root: string): number {
  return spy.mock.calls.filter(([path]) => path === root).length
}

describe('request-scoped Project root real path', () => {
  it('resolves the root once per request for many Run paths', async () => {
    const { root, runs } = await projectWithRuns(5)
    const realpath = vi.spyOn(projectFs, 'realpath')
    await withRequestScope(async () => {
      await Promise.all(runs.map((run) => resolveRunPath(root, run)))
      await resolveContained(root, 'logs')
    })
    expect(rootRealpaths(realpath, root)).toBe(1)
  })

  it('does not share the memo across requests or outside a scope', async () => {
    const { root, runs } = await projectWithRuns(2)
    const realpath = vi.spyOn(projectFs, 'realpath')
    await withRequestScope(() => resolveRunPath(root, runs[0]!))
    await withRequestScope(() => resolveRunPath(root, runs[0]!))
    await resolveRunPath(root, runs[0]!)
    await resolveRunPath(root, runs[1]!)
    expect(rootRealpaths(realpath, root)).toBe(4)
  })

  it('still rejects a symlink escaping the root inside a scope', async () => {
    const { root } = await projectWithRuns(0)
    const outside = await fs.mkdtemp(join(tmpdir(), 'memon-request-scope-outside-'))
    roots.push(outside)
    await fs.mkdir(join(root, 'logs'), { recursive: true })
    await fs.mkdir(join(outside, 'x-260101-000000'))
    await fs.symlink(join(outside, 'x-260101-000000'), join(root, 'logs', 'x-260101-000000'))
    await withRequestScope(async () => {
      await expect(resolveRunPath(root, 'logs/x-260101-000000')).rejects.toThrow(/escapes/)
      await expect(resolveContained(root, 'logs/x-260101-000000')).rejects.toBeInstanceOf(
        PathContainmentError,
      )
    })
  })

  it('resolves references by path or unique base name and reports absence as null', async () => {
    const { root, runs } = await projectWithRuns(1)
    const project = { name: 'p', root, include: [], exclude: [] }
    const walk = vi.fn(async () => [join(root, runs[0]!)])
    expect(await resolveRunReferencePath(project, runs[0]!, walk)).toBe(join(root, runs[0]!))
    expect(walk).not.toHaveBeenCalled()
    expect(await resolveRunReferencePath(project, 'r0-260101-000000', walk)).toBe(
      join(root, runs[0]!),
    )
    expect(await resolveRunReferencePath(project, 'logs/none-260101-000000', walk)).toBeNull()
  })
})
