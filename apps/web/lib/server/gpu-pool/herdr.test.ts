// @vitest-environment node
import { describe, expect, it } from 'vitest'
import {
  holdJob,
  launchTemplate,
  parseSnapshot,
  parseSteps,
  stepsToCancel,
  terminalName,
} from './herdr'

const ENTER = [
  'srun',
  '--jobid=12345',
  '--overlap',
  '-u',
  '--chdir=/tmp',
  '-N1',
  '-n1',
  '-J',
  'probe',
]

describe('launch templates', () => {
  it('reads the hold job from enter', () => {
    expect(holdJob(ENTER)).toBe('12345')
    expect(holdJob(['srun', '--jobid', '77', '--overlap'])).toBe('77')
    expect(holdJob(['ssh', 'x'])).toBeNull()
    expect(holdJob(undefined)).toBeNull()
  })

  it('wraps long tasks in their own named step and sets the environment', () => {
    const template = launchTemplate(
      { id: 'tk_00000000000a', grantedGpus: [2, 3] },
      { id: 'node-01', cluster: 'cluster-a', enter: ENTER },
    )
    const env = [
      'env',
      'CUDA_VISIBLE_DEVICES=2,3',
      'MEMON_TICKET=tk_00000000000a',
      'MEMON_NODE=node-01',
      'MEMON_CLUSTER=cluster-a',
    ]
    expect(template.exec).toEqual(env)
    expect(template.run).toEqual([
      ...env,
      'srun',
      '--jobid=12345',
      '--overlap',
      '-u',
      '--chdir=/tmp',
      '-N1',
      '-n1',
      '-J',
      'memon-task-tk_00000000000a',
    ])
    expect(template.holdJob).toBe('12345')
    const plain = launchTemplate({ id: 'tk_00000000000a', grantedGpus: [0] }, { id: 'node-02' })
    expect(plain.run).toEqual(plain.exec)
    const whole = launchTemplate(
      { id: 'tk_00000000000a', grantedGpus: [0, 1], wholeNode: true },
      { id: 'node-02', cluster: 'cluster-b' },
    )
    expect(whole.exec.slice(-2)).toEqual(['MEMON_CLUSTER=cluster-b', 'MEMON_WHOLE_NODE=1'])
  })

  it('names terminals within herdr limits', () => {
    expect(terminalName('T0012', 'main')).toBe('t0012-main')
    expect(terminalName('T0012', 'Eval Sweep #3 with a very long name')).toHaveLength(32)
  })
})

describe('reclaim step filtering', () => {
  const listing = [
    'StepId=12345.extern UserId=1 StartTime=x',
    '   Nodes=1 Name=extern Network=(null)',
    'StepId=12345.batch UserId=1',
    '   Name=batch',
    'StepId=12345.18 UserId=1',
    '   Name=herdr-core',
    'StepId=12345.21 UserId=1',
    '   Name=memon-task-tk_00000000000a',
    'StepId=12345.22 UserId=1',
    '   Name=memon-task-T0070',
    'StepId=99999.3 UserId=1',
    '   Name=memon-task-tk_00000000000a',
  ].join('\n')

  it('cancels only this ticket’s numbered steps of the hold job', () => {
    const steps = parseSteps(listing)
    expect(steps.map((s) => s.id)).toEqual([
      '12345.extern',
      '12345.batch',
      '12345.18',
      '12345.21',
      '12345.22',
      '99999.3',
    ])
    expect(stepsToCancel(steps, '12345', 'tk_00000000000a')).toEqual(['12345.21'])
  })

  it('never yields the bare hold id or the core step', () => {
    const steps = [
      { id: '12345', name: 'memon-task-tk_00000000000a' },
      { id: '12345.18', name: 'herdr-core' },
    ]
    expect(stepsToCancel(steps, '12345', 'tk_00000000000a')).toEqual([])
  })
})

describe('parseSnapshot', () => {
  it('counts compute processes per GPU', () => {
    const out = ['0, GPU-a, 0', '1, GPU-b, 40000', '__MEMON_APPS__', 'GPU-b', 'GPU-b', ''].join(
      '\n',
    )
    expect(parseSnapshot(out)).toEqual([
      { index: 0, memoryUsedMib: 0, processes: 0 },
      { index: 1, memoryUsedMib: 40000, processes: 2 },
    ])
  })
})
