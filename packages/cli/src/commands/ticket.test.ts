// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { captureCli } from '../test-support/results-project.js'
import { parseDuration, runTicket, type TicketDeps, terminalName } from './ticket.js'

const LAUNCH = {
  machine: 'node-01',
  exec: ['env', 'CUDA_VISIBLE_DEVICES=0,1', 'MEMON_TICKET=tk_7h3q9m2xw4ra'],
  run: [
    'env',
    'CUDA_VISIBLE_DEVICES=0,1',
    'MEMON_TICKET=tk_7h3q9m2xw4ra',
    'srun',
    '--jobid=12345',
    '-J',
    'memon-task-tk_7h3q9m2xw4ra',
  ],
  holdJob: '12345',
}

function deps(response: { status: number; body: unknown }, over: Partial<TicketDeps> = {}) {
  const fetchMock = vi.fn(
    async () => new Response(JSON.stringify(response.body), { status: response.status }),
  )
  const d: TicketDeps = {
    fetch: fetchMock as unknown as typeof fetch,
    env: { MEMON_CENTRAL_AUTH: 'owner:secret', MEMON_CENTRAL_URL: 'http://central.test' },
    home: '/nonexistent-memon-home',
    hc: vi.fn(async () => 7),
    hcCapture: vi.fn(async () => ({
      code: 0,
      stdout: '{"address":"node-01/tk_7h3q9m2xw4ra-train"}',
    })),
    out: vi.fn(),
    isTty: false,
    ...over,
  }
  return { d, fetchMock }
}

const granted = {
  status: 200,
  body: { ticket: { id: 'tk_7h3q9m2xw4ra', status: 'GRANTED' }, launch: LAUNCH },
}

describe('memon ticket', () => {
  it('parses durations', () => {
    expect(parseDuration('90m')).toBe(5400)
    expect(parseDuration('2d')).toBe(172800)
  })

  it('posts a request with Basic auth and the start command', async () => {
    const { d, fetchMock } = deps({
      status: 201,
      body: { ticket: { id: 'tk_7h3q9m2xw4ra', status: 'QUEUED' } },
    })
    const code = await runTicket(
      'request',
      ['python', 'train.py'],
      { project: 'project-a', duration: '6h', gpus: '2' },
      d,
    )
    expect(code).toBe(0)
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('http://central.test/api/gpu-pool/tickets')
    expect((init.headers as Record<string, string>).authorization).toBe(
      `Basic ${Buffer.from('owner:secret').toString('base64')}`,
    )
    expect(JSON.parse(init.body as string)).toEqual({
      project: 'project-a',
      duration_s: 21600,
      gpus: 2,
      run: 'python train.py',
    })
  })

  it('maps central errors to the exit-code table', async () => {
    const { d } = deps({
      status: 404,
      body: { error: { code: 'NOT_FOUND', message: 'ticket tk_0000000000zz does not exist' } },
    })
    const result = await captureCli(() => runTicket('show', ['tk_0000000000zz'], {}, d))
    expect(result.exitCode).toBe(4)
    expect(result.error?.code).toBe('NOT_FOUND')
  })

  it('rejects malformed ticket ids before calling central', async () => {
    const { d, fetchMock } = deps(granted)
    for (const id of ['T1', 'tk_short', 'TK_7H3Q9M2XW4RA']) {
      const result = await captureCli(() => runTicket('show', [id], {}, d))
      expect(result.error?.code).toBe('BAD_REQUEST')
    }
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('refuses work on tickets that are not granted', async () => {
    const { d } = deps({
      status: 200,
      body: { ticket: { id: 'tk_7h3q9m2xw4ra', status: 'QUEUED' }, launch: null },
    })
    const result = await captureCli(() =>
      runTicket('exec', ['tk_7h3q9m2xw4ra', 'nvidia-smi'], {}, d),
    )
    expect(result.exitCode).toBe(9)
    expect(d.hc).not.toHaveBeenCalled()
  })

  it('runs short commands with the ticket environment and passes the status through', async () => {
    const { d } = deps(granted)
    expect(
      await runTicket('exec', ['tk_7h3q9m2xw4ra', 'nvidia-smi', '-L'], { timeout: '60' }, d),
    ).toBe(7)
    expect(d.hc).toHaveBeenCalledWith([
      'exec',
      '-i',
      '--on',
      'node-01',
      '--timeout',
      '60',
      '--',
      'env',
      'CUDA_VISIBLE_DEVICES=0,1',
      'MEMON_TICKET=tk_7h3q9m2xw4ra',
      'bash',
      '-c',
      'nvidia-smi -L',
    ])
  })

  it('starts long tasks in a labelled terminal inside the ticket step', async () => {
    const { d } = deps(granted)
    expect(
      await runTicket('run', ['tk_7h3q9m2xw4ra', 'python', 'train.py'], { name: 'train' }, d),
    ).toBe(0)
    expect(d.hcCapture).toHaveBeenCalledWith([
      'run',
      '--on',
      'node-01',
      '--bg',
      '--name',
      'tk_7h3q9m2xw4ra-train',
      '--label',
      'ticket=tk_7h3q9m2xw4ra',
      '--label',
      'task=train',
      '--json',
      '--',
      ...LAUNCH.run,
      'bash',
      '-c',
      'python train.py',
    ])
    expect(d.out).toHaveBeenCalledWith(
      '{"ticket":"tk_7h3q9m2xw4ra","task":"train","terminal":"node-01/tk_7h3q9m2xw4ra-train"}\n',
    )
  })

  it('names terminals like the broker', () => {
    expect(terminalName('tk_7h3q9m2xw4ra', 'Main')).toBe('tk_7h3q9m2xw4ra-main')
  })
})
