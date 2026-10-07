// @vitest-environment node
import type { BackendExecutionProvider } from '@memon/backend'
import { describe, expect, it, vi } from 'vitest'
import { probeSqueue } from './probe'

function execution() {
  const run = vi
    .fn()
    .mockResolvedValue({ stdout: '', stderr: '', code: 0, timedOut: false, spawnFailed: false })
  return {
    run,
    target: { kind: 'ssh', target: 'cluster-a', remoteRoot: '/srv/project-a' },
    runBytes: vi.fn(),
    resolvePath: (path: string) => path,
  } satisfies BackendExecutionProvider
}
describe('Slurm probes use the configured execution provider', () => {
  it('runs both probes on that provider', async () => {
    const provider = execution()
    expect(await probeSqueue(provider)).toEqual({ supported: true })
    expect(provider.run.mock.calls.map(([bin, args]) => [bin, args])).toEqual([
      ['squeue', ['--version']],
      ['squeue', ['--me', '--noheader']],
    ])
  })
  it('stops after a failed target probe', async () => {
    const provider = execution()
    provider.run.mockResolvedValue({
      stdout: '',
      stderr: 'unavailable',
      code: 1,
      timedOut: false,
      spawnFailed: true,
    })
    expect((await probeSqueue(provider)).supported).toBe(false)
    expect(provider.run).toHaveBeenCalledTimes(1)
  })
})
