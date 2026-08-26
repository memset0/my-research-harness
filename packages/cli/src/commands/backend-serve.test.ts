import { EventEmitter } from 'node:events'
import { promises as fs } from 'node:fs'
import type { Server } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { BackendServerOptions } from '@memon/backend'
import { BackendReportsResponseSchema, ConfigError } from '@memon/core'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { runBackendServe } from './backend-serve.js'

const TOKEN = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'

class FakeServer extends EventEmitter {
  listenCalls: Array<{ port: number; address: string }> = []
  listenError?: Error

  listen(port: number, address: string, callback: () => void): this {
    this.listenCalls.push({ port, address })
    queueMicrotask(() => {
      if (this.listenError) this.emit('error', this.listenError)
      else callback()
    })
    return this
  }
}

let dir: string

beforeEach(async () => {
  dir = await fs.mkdtemp(join(tmpdir(), 'memon-backend-serve-'))
})

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true })
})

async function writeInstance(name: string, source: string): Promise<string> {
  const path = join(dir, name)
  await fs.writeFile(path, source, { mode: 0o600 })
  await fs.chmod(path, 0o600)
  return path
}

function backendYaml(): string {
  return `
projects:
  - { name: project-a, root: ./project-a }
terminal:
  tmux_enabled: false
  herdr:
    cli: [herdr]
slurm:
  total_nodes: 8
backend:
  host_id: host-a
  bind_addr: 127.0.0.2
  bind_port: 4738
  tokens:
    current: ${TOKEN}
  daemon:
    state_dir: ./private-state
    release_dir: ./private-releases
    runtime_dir: ./private-run
`
}

describe('runBackendServe', () => {
  it('loads an explicit Backend instance and starts the real server factory contract', async () => {
    const configPath = await writeInstance('backend.yml', backendYaml())
    const fakeServer = new FakeServer()
    const serverFactory = vi.fn((_options: BackendServerOptions) => fakeServer as unknown as Server)
    const output: string[] = []

    const result = await runBackendServe(
      { cwd: dir, configPath, format: 'json' },
      { serverFactory, writeOutput: (text) => output.push(text) },
    )

    expect(serverFactory).toHaveBeenCalledOnce()
    expect(serverFactory.mock.calls[0]?.[0]).toMatchObject({
      hostId: 'host-a',
      serviceTokens: { current: TOKEN },
      capabilities: {
        projects: true,
        mutations: true,
        events: true,
        logStreaming: true,
        reportAssets: true,
        git: true,
        shares: true,
        tmux: false,
        terminal: true,
        slurm: true,
        herdr: true,
      },
    })
    expect(fakeServer.listenCalls).toEqual([{ address: '127.0.0.2', port: 4738 }])
    expect(result.server).toBe(fakeServer)

    const status = JSON.parse(output.join(''))
    expect(status).toMatchObject({
      action: 'backend-serve',
      outcome: 'listening',
      host: 'host-a',
      bind: { address: '127.0.0.2', port: 4738 },
      configPath,
    })
    expect(output.join('')).not.toContain(TOKEN)
    expect(output.join('')).not.toContain('private-state')
    expect(output.join('')).not.toContain('private-releases')
    expect(output.join('')).not.toContain('private-run')

    const projectRoot = join(dir, 'project-a')
    await fs.mkdir(join(projectRoot, '.memon'), { recursive: true })
    await fs.mkdir(join(projectRoot, 'docs', 'reports'), { recursive: true })
    await fs.mkdir(join(projectRoot, 'logs', 'run-one'), { recursive: true })
    await fs.writeFile(join(projectRoot, 'docs', 'reports', 'R0001-report.md'), '# Report\n')
    await fs.writeFile(join(projectRoot, 'logs', 'run-one', 'README.md'), '# Run\n')
    await fs.writeFile(join(projectRoot, 'logs', 'run-one', 'train.log'), 'line\n')
    await fs.writeFile(
      join(projectRoot, '.memon', 'shares.json'),
      JSON.stringify({
        version: 1,
        shares: [
          {
            id: 'shr_test',
            token: 'valid_share_token',
            created_at: '2026-08-26T12:00:00Z',
            expires_at: null,
          },
        ],
      }),
    )
    const serverOptions = serverFactory.mock.calls[0]?.[0]
    expect(serverOptions?.eventStream?.instanceEpoch).toBe(serverOptions?.instanceEpoch)
    expect(serverOptions?.filesystemMonitor).toBeInstanceOf(Object)
    expect(serverOptions?.terminalService).toBeInstanceOf(Object)
    expect(serverOptions?.terminalTargetResolver).toBeUndefined()
    if (!serverOptions?.documentService) {
      throw new Error('Backend document service was not configured')
    }
    if (!serverOptions.gitService) {
      throw new Error('Backend Git service was not configured')
    }
    if (!serverOptions.streamService) {
      throw new Error('Backend stream service was not configured')
    }
    expect(
      BackendReportsResponseSchema.parse(
        await serverOptions.documentService.listReports('project-a'),
      ).reports,
    ).toEqual([expect.objectContaining({ id: 'R0001', project: 'project-a', slug: 'report' })])
    expect(await serverOptions.gitService.status('project-a')).toMatchObject({ enabled: false })
    expect(
      await serverOptions.streamService.listLogFiles('project-a', 'logs/run-one/README.md'),
    ).toEqual({
      files: [expect.objectContaining({ name: 'train.log', resource: 'logs/run-one/train.log' })],
    })
    expect(await serverOptions?.shareValidator?.('project-a', 'valid_share_token')).toBe(true)
    expect(await serverOptions?.shareValidator?.('project-a', 'invalid_share_token')).toBe(false)
    expect(await serverOptions?.shareValidator?.('missing-project', 'valid_share_token')).toBe(
      false,
    )
    const shareProviders = serverOptions?.shareProviders
    if (!shareProviders?.list || !shareProviders.add || !shareProviders.revoke) {
      throw new Error('Backend share providers were not configured')
    }
    expect(await shareProviders.list('project-a', true)).toEqual([
      expect.objectContaining({ id: 'shr_test', token: 'valid_share_token' }),
    ])
    const added = await shareProviders.add('project-a', {
      label: 'Central reviewer',
      expires: 'never',
    })
    expect(added).toMatchObject({ label: 'Central reviewer' })
    const addedId = (added as { id: string }).id
    expect(await shareProviders.revoke('project-a', addedId)).toEqual([
      expect.objectContaining({ id: addedId }),
    ])
    serverOptions?.filesystemMonitor?.stop()
  })

  it('uses cwd/config.yml by default and emits redacted human status', async () => {
    const configPath = await writeInstance('config.yml', backendYaml())
    const fakeServer = new FakeServer()
    const output: string[] = []
    await runBackendServe(
      { cwd: dir, format: 'human' },
      {
        serverFactory: () => fakeServer as unknown as Server,
        writeOutput: (text) => output.push(text),
      },
    )

    expect(output.join('')).toContain('memon Backend host-a listening on 127.0.0.2:4738')
    expect(output.join('')).toContain(`config ${configPath}`)
    expect(output.join('')).not.toContain(TOKEN)
  })

  it('applies read_only capabilities only after config change and restart', async () => {
    const source = backendYaml().replace('backend:\n', 'backend:\n  access_mode: read_only\n')
    const configPath = await writeInstance('backend.yml', source)
    const fakeServer = new FakeServer()
    const serverFactory = vi.fn((_options: BackendServerOptions) => fakeServer as unknown as Server)
    await runBackendServe(
      { cwd: dir, configPath, format: 'json' },
      { serverFactory, writeOutput: () => undefined },
    )
    expect(serverFactory.mock.calls[0]?.[0]).toMatchObject({
      readOnly: true,
      capabilities: {
        projects: true,
        mutations: false,
        tmux: false,
        terminal: false,
        slurm: false,
        herdr: false,
      },
    })
  })

  it.each([
    [
      'standalone',
      `projects:\n  - { name: project-a, root: ./project-a }\n`,
      'must contain a `backend:` role block',
    ],
    ['central', `central:\n  hosts: []\n`, 'must contain a `backend:` role block'],
  ])('rejects a %s instance before creating a server', async (_kind, source, message) => {
    const configPath = await writeInstance('instance.yml', source)
    const serverFactory = vi.fn()
    await expect(
      runBackendServe(
        { cwd: dir, configPath, format: 'json' },
        { serverFactory: serverFactory as never },
      ),
    ).rejects.toMatchObject({ message: expect.stringContaining(message) })
    expect(serverFactory).not.toHaveBeenCalled()
  })

  it('rejects the protected example before reading or creating a server', async () => {
    const serverFactory = vi.fn()
    await expect(
      runBackendServe(
        { cwd: dir, configPath: 'config.example.yml', format: 'json' },
        { serverFactory: serverFactory as never },
      ),
    ).rejects.toBeInstanceOf(ConfigError)
    expect(serverFactory).not.toHaveBeenCalled()
  })

  it('rejects human authentication in a Backend instance', async () => {
    const configPath = await writeInstance(
      'backend.yml',
      `${backendYaml()}\nauth:\n  username: owner\n  password: browser-secret\n`,
    )
    const serverFactory = vi.fn()
    await expect(
      runBackendServe(
        { cwd: dir, configPath, format: 'json' },
        { serverFactory: serverFactory as never },
      ),
    ).rejects.toMatchObject({
      message: expect.stringContaining('must not define browser-facing `auth:` credentials'),
    })
    expect(serverFactory).not.toHaveBeenCalled()
  })

  it('fails safely when the listener cannot start', async () => {
    const configPath = await writeInstance('backend.yml', backendYaml())
    const fakeServer = new FakeServer()
    fakeServer.listenError = new Error(`listen failed with private token ${TOKEN}`)
    const output: string[] = []

    await expect(
      runBackendServe(
        { cwd: dir, configPath, format: 'json' },
        {
          serverFactory: () => fakeServer as unknown as Server,
          writeOutput: (text) => output.push(text),
        },
      ),
    ).rejects.toMatchObject({
      message: 'Backend failed to listen on 127.0.0.2:4738',
    })
    expect(output).toEqual([])
  })
})
