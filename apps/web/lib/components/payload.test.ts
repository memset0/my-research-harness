// @vitest-environment node

import { describe, expect, it } from 'vitest'
import { derivePayload, executableFunctionName, stripHiddenKeys } from './payload'

describe('derivePayload', () => {
  it('parses YAML and JSON objects and wraps every other language as data', () => {
    expect(derivePayload('yaml', 'x: 1')).toEqual({ kind: 'static', value: { x: 1 } })
    expect(derivePayload('json', '{"x":1}')).toEqual({ kind: 'static', value: { x: 1 } })
    expect(derivePayload('html', '<p>x</p>')).toEqual({
      kind: 'static',
      value: { data: '<p>x</p>' },
    })
  })

  it.each([
    ['alias', 'yaml', 'x: &x 1\ny: *x'],
    ['duplicate key', 'yaml', 'x: 1\nx: 2'],
    ['JSON array', 'json', '[1,2]'],
  ])('rejects %s', (_label, lang, body) => {
    expect(derivePayload(lang, body).kind).toBe('error')
  })

  it('derives script and code executables with kwargs', () => {
    const script = derivePayload('yaml', 'script: scripts/a.py::collect\nmetric: fid')
    expect(script).toEqual({
      kind: 'executable',
      spec: { script: 'scripts/a.py::collect', kwargs: { metric: 'fid' } },
    })
    if (script.kind === 'executable') expect(executableFunctionName(script.spec)).toBe('collect')
    const code = derivePayload('yaml', 'code: |\n  def make(**kw):\n    return {}\nmetric: fid')
    expect(code.kind).toBe('executable')
    if (code.kind === 'executable') expect(executableFunctionName(code.spec)).toBe('make')
  })

  it.each([
    ['both executable keys', 'script: a.py::f\ncode: |\n  def f():\n    pass'],
    ['reserved kwarg', 'script: a.py::f\n__id: no'],
    ['zero defs', 'code: |\n  return {}'],
    ['two defs', 'code: |\n  def a():\n    pass\n  def b():\n    pass'],
  ])('rejects %s', (_label, body) => {
    expect(derivePayload('yaml', body).kind).toBe('error')
  })

  it('strips all cache metadata before schema validation', () => {
    expect(stripHiddenKeys({ data: 1, __component_id: 'x', __last_error: {} })).toEqual({ data: 1 })
  })
})
