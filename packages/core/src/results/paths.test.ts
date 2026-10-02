import { describe, expect, it } from 'vitest'
import {
  isResultPathWithin,
  replaceResultPathPrefix,
  resultGroupPathError,
  resultPathError,
  resultPathGroups,
  resultPathLeaf,
  resultPathParent,
  resultPathPartition,
} from './paths.js'

describe('result paths', () => {
  it('accepts dotted paths under the three partitions', () => {
    for (const path of ['params.optim.lr', 'metrics.eval.fid', 'env.CUDA_VERSION', 'params.a-b_c'])
      expect(resultPathError(path)).toBeNull()
  })

  it('rejects partitions, unknown partitions, empty and malformed segments', () => {
    expect(resultPathError('metrics')).toMatch(/must name a value/)
    expect(resultPathError('outputs.fid')).toMatch(/partitions/)
    expect(resultPathError('metrics..fid')).toMatch(/segment ""/)
    expect(resultPathError('metrics.1fid')).toMatch(/segment "1fid"/)
    expect(resultPathError('metrics.f id')).toMatch(/segment "f id"/)
    expect(resultPathError('')).toMatch(/empty/)
  })

  it('accepts a partition or a deeper prefix as a group', () => {
    expect(resultGroupPathError('env')).toBeNull()
    expect(resultGroupPathError('params.optim')).toBeNull()
    expect(resultGroupPathError('logs')).toMatch(/partitions/)
  })

  it('derives partitions, groups and labels', () => {
    expect(resultPathPartition('params.optim.lr')).toBe('params')
    expect(resultPathParent('params.optim.lr')).toBe('params.optim')
    expect(resultPathGroups('params.optim.adam.beta1')).toEqual([
      'params',
      'params.optim',
      'params.optim.adam',
    ])
    expect(resultPathLeaf('metrics.eval.lpips')).toBe('lpips')
    expect(isResultPathWithin('params.optim.lr', 'params.optim')).toBe(true)
    expect(isResultPathWithin('params.optimizer', 'params.optim')).toBe(false)
    expect(replaceResultPathPrefix('params.lr_group.lr', 'params.lr_group', 'params.optim')).toBe(
      'params.optim.lr',
    )
    expect(replaceResultPathPrefix('params.lr_groupx', 'params.lr_group', 'params.optim')).toBe(
      'params.lr_groupx',
    )
  })
})
