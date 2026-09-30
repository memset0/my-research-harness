import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { withProjectFileContext } from '../project-file-store.js'

import {
  cachedGitCommand,
  execFileGitCommand,
  type GitCommandOptions,
  type GitCommandResult,
  type GitCommandRunner,
  invalidateGitOperations,
  isGitCommandFailure,
} from './command.js'

// The cache is process-wide (one state on `globalThis`), so every case starts
// from an empty one and uses its own cwd.
beforeEach(() => {
  invalidateGitOperations()
})

afterEach(() => {
  vi.restoreAllMocks()
  invalidateGitOperations()
})

interface RecordedCall {
  bin: string
  args: readonly string[]
  opts: GitCommandOptions
}

function ok(stdout: string | Buffer, stderr = ''): GitCommandResult {
  return { stdout, stderr, code: 0 }
}

/** A runner that records every invocation and answers from `answers` in order. */
function recording(answers: (call: RecordedCall) => GitCommandResult | Promise<GitCommandResult>): {
  calls: RecordedCall[]
  runner: GitCommandRunner
} {
  const calls: RecordedCall[] = []
  const runner: GitCommandRunner = (bin, args, opts) => {
    const call = { bin, args, opts }
    calls.push(call)
    return Promise.resolve(answers(call))
  }
  return { calls, runner }
}

const READ = ['status', '--porcelain=v2'] as const

function options(cwd: string, extra: Partial<GitCommandOptions> = {}): GitCommandOptions {
  return { cwd, timeoutMs: 1000, maxBuffer: 1024, ...extra }
}

describe('cachedGitCommand reads', () => {
  it('runs one command for concurrent equal reads and serves the next one from memory', async () => {
    let release: (() => void) | undefined
    const gate = new Promise<void>((settle) => {
      release = settle
    })
    const { calls, runner } = recording(async () => {
      await gate
      return ok('branch.head main\n')
    })
    const exec = cachedGitCommand(runner, 'test:coalesce')

    const first = exec('git', READ, options('/tmp/memon-cache/a'))
    const second = exec('git', READ, options('/tmp/memon-cache/a'))
    release?.()
    const [a, b] = await Promise.all([first, second])

    expect(calls).toHaveLength(1)
    expect(a.stdout).toBe('branch.head main\n')
    expect(b.stdout).toBe(a.stdout)

    // Sequential caller after both settled: still no second invocation.
    expect((await exec('git', READ, options('/tmp/memon-cache/a'))).stdout).toBe(
      'branch.head main\n',
    )
    expect(calls).toHaveLength(1)
  })

  it('shares nothing between execution targets, working copies, or encodings', async () => {
    const { calls, runner } = recording(() => ok('local\n'))
    const here = cachedGitCommand(runner, 'test:host-a')
    const there = cachedGitCommand(runner, 'test:host-b')

    await here('git', READ, options('/tmp/memon-cache/iso'))
    await there('git', READ, options('/tmp/memon-cache/iso'))
    await here('git', READ, options('/tmp/memon-cache/other'))
    await here('git', READ, options('/tmp/memon-cache/iso', { encoding: 'buffer' }))
    await here('git', ['status', '--porcelain=v1'], options('/tmp/memon-cache/iso'))

    // Same argv on another host, another working copy, another encoding and
    // another argv are four different questions.
    expect(calls).toHaveLength(5)
    await here('git', READ, options('/tmp/memon-cache/iso'))
    expect(calls).toHaveLength(5)
  })

  it('does not let a cached permissive read bypass a stricter output limit', async () => {
    const exec = cachedGitCommand()
    const args = ['rev-parse', '--show-toplevel']
    const cwd = process.cwd()
    const allowed = await exec('git', args, options(cwd))
    expect(isGitCommandFailure(allowed)).toBe(false)
    const bounded = await exec('git', args, options(cwd, { maxBuffer: 1 }))
    expect(isGitCommandFailure(bounded)).toBe(true)
  })

  it('observes external changes on manual request without waiting for the read TTL', async () => {
    let head = 'before'
    const { runner } = recording(() => ok(head))
    const exec = cachedGitCommand(runner, 'test:manual-context')
    const cwd = '/tmp/memon-cache/manual'
    expect((await exec('git', READ, options(cwd))).stdout).toBe('before')
    head = 'after'
    expect((await exec('git', READ, options(cwd))).stdout).toBe('before')
    const refreshed = await withProjectFileContext({ root: cwd, reason: 'manual' }, () =>
      exec('git', READ, options(cwd)),
    )
    expect(refreshed.stdout).toBe('after')
  })

  it('expires a working-copy read but keeps an object read addressed by full SHA', async () => {
    const sha = 'a'.repeat(40)
    const now = vi.spyOn(performance, 'now')
    now.mockReturnValue(0)
    const { calls, runner } = recording(() => ok('answer\n'))
    const exec = cachedGitCommand(runner, 'test:ttl')

    await exec('git', READ, options('/tmp/memon-cache/ttl'))
    await exec('git', ['show', `${sha}:app.ts`], options('/tmp/memon-cache/ttl'))
    expect(calls).toHaveLength(2)

    now.mockReturnValue(4_000)
    await exec('git', READ, options('/tmp/memon-cache/ttl'))
    expect(calls).toHaveLength(2)

    // A composed remote review can take longer than a browser's 5s staleTime.
    now.mockReturnValue(12_000)
    await exec('git', READ, options('/tmp/memon-cache/ttl'))
    expect(calls).toHaveLength(2)

    now.mockReturnValue(31_000)
    await exec('git', READ, options('/tmp/memon-cache/ttl'))
    // The working copy may have moved; the object cannot have.
    expect(calls).toHaveLength(3)
    await exec('git', ['show', `${sha}:app.ts`], options('/tmp/memon-cache/ttl'))
    expect(calls).toHaveLength(3)
  })

  it('never saves a failure, and retries it for the next caller', async () => {
    let attempt = 0
    const { calls, runner } = recording(() => {
      attempt += 1
      return attempt === 1
        ? { stdout: '', stderr: 'fatal: not a git repository\n', code: 128 }
        : ok('recovered\n')
    })
    const exec = cachedGitCommand(runner, 'test:failure')

    const failed = await exec('git', READ, options('/tmp/memon-cache/fail'))
    expect(failed.code).toBe(128)

    const retried = await exec('git', READ, options('/tmp/memon-cache/fail'))
    expect(calls).toHaveLength(2)
    expect(retried.stdout).toBe('recovered\n')
  })

  it('does not save a read that a transport failure produced, timeout included', async () => {
    let attempt = 0
    const { calls, runner } = recording(() => {
      attempt += 1
      return attempt === 1
        ? { stdout: '', stderr: '', code: -1, spawnFailed: true, message: 'spawn ssh ENOENT' }
        : ok('reachable\n')
    })
    const exec = cachedGitCommand(runner, 'test:unreachable')

    expect((await exec('git', READ, options('/tmp/memon-cache/ssh'))).spawnFailed).toBe(true)
    expect((await exec('git', READ, options('/tmp/memon-cache/ssh'))).stdout).toBe('reachable\n')
    expect(calls).toHaveLength(2)
  })

  it('propagates a rejecting runner without saving anything', async () => {
    let attempt = 0
    const { calls, runner } = recording(() => {
      attempt += 1
      if (attempt === 1) throw new Error('transport exploded')
      return ok('second\n')
    })
    const exec = cachedGitCommand(runner, 'test:throw')

    await expect(exec('git', READ, options('/tmp/memon-cache/throw'))).rejects.toThrow(
      'transport exploded',
    )
    expect((await exec('git', READ, options('/tmp/memon-cache/throw'))).stdout).toBe('second\n')
    expect(calls).toHaveLength(2)
  })
})

describe('cachedGitCommand mutations', () => {
  it('runs a mutation uncached and drops the observations around it', async () => {
    const { calls, runner } = recording((call) =>
      ok(call.args[0] === 'status' ? `status ${calls.length}\n` : 'mutated\n'),
    )
    const exec = cachedGitCommand(runner, 'test:mutation')

    await exec('git', READ, options('/tmp/memon-cache/repo'))
    await exec('git', ['commit', '-m', 'wiki: change'], options('/tmp/memon-cache/repo'))
    await exec('git', ['commit', '-m', 'wiki: again'], options('/tmp/memon-cache/repo'))
    await exec('git', READ, options('/tmp/memon-cache/repo'))

    // Two mutations, both executed; the status read after them is re-run.
    expect(calls.map((call) => call.args[0])).toEqual(['status', 'commit', 'commit', 'status'])
  })

  it('discards a read that was in flight while a mutation ran', async () => {
    let release: (() => void) | undefined
    const gate = new Promise<void>((settle) => {
      release = settle
    })
    const { calls, runner } = recording(async (call) => {
      if (call.args[0] !== 'status') return ok('mutated\n')
      await gate
      return ok('pre-mutation\n')
    })
    const exec = cachedGitCommand(runner, 'test:overlap')

    const inFlight = exec('git', READ, options('/tmp/memon-cache/overlap'))
    await exec('git', ['add', '-A'], options('/tmp/memon-cache/overlap'))
    release?.()
    expect((await inFlight).stdout).toBe('pre-mutation\n')

    // The overlapping read answered its own caller but must not have been
    // saved: the index moved underneath it.
    await exec('git', READ, options('/tmp/memon-cache/overlap'))
    expect(calls.filter((call) => call.args[0] === 'status')).toHaveLength(2)
  })

  it('invalidates by working-copy subtree in both directions', async () => {
    const { calls, runner } = recording(() => ok('entry\n'))
    const exec = cachedGitCommand(runner, 'test:invalidate')
    const parent = '/tmp/memon-cache/parent'
    const child = '/tmp/memon-cache/parent/vendor/sub'
    const unrelated = '/tmp/memon-cache/elsewhere'

    await exec('git', READ, options(parent))
    await exec('git', READ, options(child))
    await exec('git', READ, options(unrelated))
    expect(calls).toHaveLength(3)

    // A change under the submodule invalidates the superproject's status too,
    // and vice versa; an unrelated repository is untouched.
    invalidateGitOperations(child)
    await exec('git', READ, options(parent))
    await exec('git', READ, options(child))
    await exec('git', READ, options(unrelated))
    expect(calls).toHaveLength(5)

    invalidateGitOperations(parent)
    await exec('git', READ, options(child))
    expect(calls).toHaveLength(6)
  })
})

describe('cachedGitCommand freshness overrides', () => {
  it('re-reads on refresh and skips the cache entirely on bypass', async () => {
    let answer = 'first\n'
    const { calls, runner } = recording(() => ok(answer))
    const exec = cachedGitCommand(runner, 'test:refresh')
    const cwd = '/tmp/memon-cache/refresh'

    expect((await exec('git', READ, options(cwd))).stdout).toBe('first\n')
    answer = 'second\n'
    expect((await exec('git', READ, options(cwd, { cache: 'refresh' }))).stdout).toBe('second\n')
    // The refreshed answer replaces the saved one.
    expect((await exec('git', READ, options(cwd))).stdout).toBe('second\n')
    expect(calls).toHaveLength(2)

    answer = 'third\n'
    expect((await exec('git', READ, options(cwd, { cache: 'bypass' }))).stdout).toBe('third\n')
    expect(calls).toHaveLength(3)
    // A bypassed read leaves no answer older than the one it just observed.
    answer = 'fourth\n'
    expect((await exec('git', READ, options(cwd))).stdout).toBe('fourth\n')
    expect(calls).toHaveLength(4)
  })
})

describe('cachedGitCommand result ownership', () => {
  it('hands every caller its own stdout buffer', async () => {
    const { calls, runner } = recording(() => ok(Buffer.from([0x89, 0x50, 0x4e, 0x47])))
    const exec = cachedGitCommand(runner, 'test:buffer')
    const cwd = '/tmp/memon-cache/buffer'
    const args = ['show', `${'b'.repeat(40)}:plot.png`]

    const first = await exec('git', args, options(cwd, { encoding: 'buffer' }))
    const buffer = first.stdout as Buffer
    buffer.fill(0)

    const second = await exec('git', args, options(cwd, { encoding: 'buffer' }))
    expect(calls).toHaveLength(1)
    expect([...(second.stdout as Buffer)]).toEqual([0x89, 0x50, 0x4e, 0x47])
    expect(second.stdout).not.toBe(first.stdout)
  })

  it('bounds what it keeps, dropping the oldest reads first', async () => {
    const { calls, runner } = recording(() => ok('bounded\n'))
    const exec = cachedGitCommand(runner, 'test:bounded')
    // More reads than the entry cap (256), each a distinct working copy.
    for (let index = 0; index < 300; index += 1) {
      await exec('git', READ, options(`/tmp/memon-cache/bounded/${index}`))
    }
    expect(calls).toHaveLength(300)

    // The newest read is still cached; the oldest was evicted.
    await exec('git', READ, options('/tmp/memon-cache/bounded/299'))
    expect(calls).toHaveLength(300)
    await exec('git', READ, options('/tmp/memon-cache/bounded/0'))
    expect(calls).toHaveLength(301)
  })

  it('still bounds itself when the reads all land at once', async () => {
    const { calls, runner } = recording(() => ok('burst\n'))
    const exec = cachedGitCommand(runner, 'test:burst')
    const burst: Promise<GitCommandResult>[] = []
    for (let index = 0; index < 300; index += 1) {
      burst.push(exec('git', READ, options(`/tmp/memon-cache/burst/${index}`)))
    }
    await Promise.all(burst)
    expect(calls).toHaveLength(300)

    // Every read of the burst finishes in the same batch, so eviction has to
    // treat a *finished* read as evictable — otherwise the cache keeps all 300.
    await exec('git', READ, options('/tmp/memon-cache/burst/0'))
    expect(calls).toHaveLength(301)
    await exec('git', READ, options('/tmp/memon-cache/burst/299'))
    expect(calls).toHaveLength(301)
  })
})

describe('cachedGitCommand wrapping', () => {
  it('returns an already wrapped runner unchanged', () => {
    const { runner } = recording(() => ok(''))
    const wrapped = cachedGitCommand(runner, 'test:idempotent')
    expect(cachedGitCommand(wrapped)).toBe(wrapped)
    expect(cachedGitCommand(wrapped, 'test:other')).toBe(wrapped)
  })

  it('coalesces across wrappers built per request when they name the same target', async () => {
    const { calls, runner } = recording(() => ok('remote\n'))
    const cwd = '/tmp/memon-cache/per-request'
    // What the Backend does: a provider — and therefore a runner closure — is
    // resolved per request. Only the target namespace is stable.
    for (let request = 0; request < 3; request += 1) {
      const perRequest: GitCommandRunner = (bin, args, opts) => runner(bin, args, opts)
      await cachedGitCommand(perRequest, 'ssh:host-a')('git', READ, options(cwd))
    }
    expect(calls).toHaveLength(1)

    // A different target with an equally fresh closure must not read host-a's
    // answer.
    const otherHost: GitCommandRunner = (bin, args, opts) => runner(bin, args, opts)
    await cachedGitCommand(otherHost, 'ssh:host-b')('git', READ, options(cwd))
    expect(calls).toHaveLength(2)
  })

  it('gives every wrapper of the local transport the one shared local namespace', async () => {
    const { calls, runner } = recording(() => ok('answered by the stand-in transport\n'))
    const cwd = '/tmp/memon-cache/local-namespace'
    // A stand-in for the process' own transport, registered under the name the
    // local transport gets.
    await cachedGitCommand(runner, 'local')('git', READ, options(cwd))

    // Neither of these names a namespace, so both must land on `local` and be
    // served that answer — nothing is spawned.
    for (const exec of [cachedGitCommand(), cachedGitCommand(execFileGitCommand)]) {
      const served = await exec('git', READ, options(cwd))
      expect(served.stdout).toBe('answered by the stand-in transport\n')
    }
    expect(calls).toHaveLength(1)
  })
})
