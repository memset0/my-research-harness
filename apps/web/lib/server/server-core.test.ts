// @vitest-environment node

import { once } from 'node:events'
import type { Server } from 'node:http'
import { request as httpRequest } from 'node:http'
import type { AddressInfo } from 'node:net'
import { connect } from 'node:net'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createMemonServer } from './server-core'

const servers = new Set<Server>()

afterEach(async () => {
  await Promise.all([...servers].map((server) => promisify(server.close.bind(server))()))
  servers.clear()
})

async function listen(server: Server): Promise<number> {
  servers.add(server)
  const listening = once(server, 'listening')
  server.listen(0, '127.0.0.1')
  await listening
  return (server.address() as AddressInfo).port
}

async function get(port: number, path: string): Promise<{ status: number; body: string }> {
  const request = httpRequest({ host: '127.0.0.1', port, path })
  const responseReady = once(request, 'response')
  request.end()
  const [response] = (await responseReady) as [import('node:http').IncomingMessage]
  const chunks: Buffer[] = []
  for await (const chunk of response) chunks.push(Buffer.from(chunk))
  return { status: response.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf8') }
}

async function upgrade(port: number, path: string): Promise<string> {
  const socket = connect(port, '127.0.0.1')
  const closed = once(socket, 'close')
  let data = ''
  socket.setEncoding('utf8')
  socket.on('data', (chunk) => {
    data += chunk
    if (data.includes('\r\n\r\n')) socket.destroy()
  })
  await once(socket, 'connect')
  socket.write(
    `GET ${path} HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n`,
  )
  await closed
  return data
}

describe('createMemonServer', () => {
  it('delegates ordinary HTTP requests to the application handler', async () => {
    const handle = vi.fn((_request, response) => response.end('next'))
    const port = await listen(createMemonServer({ handle }))

    expect(await get(port, '/dashboard')).toEqual({ status: 200, body: 'next' })
    expect(handle).toHaveBeenCalledOnce()
  })

  it('lets the central gateway claim matching requests and delegates misses', async () => {
    const handle = vi.fn((_request, response) => response.end('next'))
    const centralGateway = vi.fn(async (request, response) => {
      if (request.url !== '/api/runs?host=host-a') return false
      response.end('central')
      return true
    })
    const port = await listen(createMemonServer({ handle, centralGateway }))

    expect(await get(port, '/api/runs?host=host-a')).toEqual({ status: 200, body: 'central' })
    expect(await get(port, '/dashboard')).toEqual({ status: 200, body: 'next' })
    expect(handle).toHaveBeenCalledOnce()
  })

  it('returns 500 and reports a central gateway failure', async () => {
    const error = new Error('gateway failed')
    const onProxyError = vi.fn()
    const port = await listen(
      createMemonServer({
        handle: (_request, response) => {
          response.end('next')
        },
        centralGateway: async () => {
          throw error
        },
        onProxyError,
      }),
    )

    expect((await get(port, '/api/runs?host=host-a')).status).toBe(500)
    expect(onProxyError).toHaveBeenCalledWith(error)
  })

  it('delegates WebSocket upgrades to the supplied application handler', async () => {
    const upgradeHandler = vi.fn((_request, socket) => {
      socket.end('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\n\r\n')
    })
    const port = await listen(
      createMemonServer({
        handle: (_request, response) => {
          response.end('next')
        },
        upgradeHandler,
      }),
    )

    expect(await upgrade(port, '/_next/webpack-hmr')).toContain('101 Switching Protocols')
    expect(upgradeHandler).toHaveBeenCalledOnce()
  })
})
