import * as native from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  dirname,
  fileProjectURI,
  isAbsolute,
  join,
  parseFileURI,
  relative,
  resolve,
} from './paths.js'

describe('logical file authority paths', () => {
  it('preserves native path behaviour', () => {
    expect(join('/project-a', 'docs', '../README.md')).toBe(
      native.join('/project-a', 'docs', '../README.md'),
    )
    expect(resolve('./project-a')).toBe(native.resolve('./project-a'))
    expect(dirname('/project-a/docs')).toBe(native.dirname('/project-a/docs'))
  })
  it('resolves a file authority without inventing a machine pathname', () => {
    const root = fileProjectURI('agent-a', 'project-a')
    expect(isAbsolute(root)).toBe(true)
    const file = join(root, 'docs', 'README.md')
    expect(parseFileURI(file)).toEqual({
      connection: 'agent-a',
      project: 'project-a',
      path: 'docs/README.md',
      root,
    })
    expect(resolve(root, 'docs', '../README.md')).toBe(join(root, 'README.md'))
    expect(relative(root, file)).toBe('docs/README.md')
    expect(dirname(file)).toBe(join(root, 'docs'))
  })
  it('keeps native absolute destinations and cross-project paths outside an authority', () => {
    const root = fileProjectURI('agent-a', 'project-a')
    expect(resolve(root, '/outside')).toBe('/outside')
    expect(relative(root, fileProjectURI('agent-a', 'project-b'))).toMatch(/^\.\.\//)
    expect(() => join(root, fileProjectURI('agent-b', 'project-a'))).toThrow()
    expect(() => parseFileURI(`${root}/../outside`)).toThrow()
  })
})
