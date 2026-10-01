// @vitest-environment node

import { EventEmitter } from 'node:events'
import { CentralEventSchema, type Config, type HostAvailabilityState } from '@memon/core'
import { describe, expect, it, vi } from 'vitest'
import { BackendEventClientError, type CentralEventFanInOptions } from './backend-events'
import { initializeCentralFleetRuntime } from './fleet-runtime'

const TOKEN_A = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
const TOKEN_B = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'

function centralConfig(): Config {
  return {
    central: {
      bindAddr: '127.0.0.1',
      bindPort: 3737,
      hosts: [
        {
          id: 'host-a',
          tokens: { current: TOKEN_A },
          transport: {
            kind: 'url',
            baseUrl: 'https://backend.example.test',
            allowInsecureHttp: false,
          },
        },
        {
          id: 'host-b',
          tokens: { current: TOKEN_B },
          transport: {
            kind: 'ssh',
            executable: 'ssh',
            target: 'tunnel@backend.example.test',
            knownHostsFile: '/run/memon/known_hosts',
            localPort: 4738,
            remoteHost: '127.0.0.1',
            remotePort: 3738,
          },
        },
      ],
    },
  } as Config
}

describe('initializeCentralFleetRuntime', () => {
  it('starts one event Host per config, emits one central bus topic, isolates failure, and cleans up', async () => {
    const order: string[] = []
    const markFailure = vi.fn()
    const getAvailability = vi.fn((_hostId: string): { state: HostAvailabilityState } => ({
      state: 'online',
    }))
    const fleet = {
      registry: { markFailure, getAvailability },
      start: vi.fn(async () => {
        order.push('fleet-start')
      }),
      stop: vi.fn(() => {
        order.push('fleet-stop')
      }),
    }
    let fanInOptions: CentralEventFanInOptions | undefined
    const addHost = vi.fn()
    const fanIn = {
      addHost,
      start: vi.fn(() => {
        order.push('fanin-start')
      }),
      stop: vi.fn(async () => {
        order.push('fanin-stop')
      }),
    }
    const events = new EventEmitter()
    const received = vi.fn()
    events.on('central-event', received)

    const handle = await initializeCentralFleetRuntime(
      { config: centralConfig(), events },
      {
        createFleet: () => fleet,
        createEventFanIn: (options) => {
          fanInOptions = options
          return fanIn
        },
      },
    )

    expect(addHost).toHaveBeenCalledTimes(2)
    expect(addHost.mock.calls[0]![0]).toEqual({
      hostId: 'host-a',
      transport: 'url',
      baseUrl: 'https://backend.example.test',
      serviceToken: TOKEN_A,
    })
    expect(addHost.mock.calls[1]![0]).toEqual({
      hostId: 'host-b',
      transport: 'ssh',
      baseUrl: 'http://127.0.0.1:4738',
      serviceToken: TOKEN_B,
    })
    expect(order.slice(0, 2)).toEqual(['fleet-start', 'fanin-start'])

    const event = CentralEventSchema.parse({
      kind: 'host-resync',
      host: 'host-b',
      reason: 'reconnect',
      emittedAt: '2026-08-26T17:00:00.000Z',
    })
    await fanInOptions!.sink(event)
    expect(received).toHaveBeenCalledWith(event)

    getAvailability.mockReturnValue({ state: 'offline' })
    await fanInOptions!.sink(event)
    expect(received).toHaveBeenCalledTimes(1)

    fanInOptions!.onHostFailure?.(
      'host-a',
      new BackendEventClientError('authentication_failed', 'event auth failed'),
    )
    expect(markFailure).toHaveBeenCalledTimes(1)
    expect(markFailure).toHaveBeenCalledWith('host-a', 'authentication_failed', 'event auth failed')

    await handle.stop()
    expect(order.slice(-2)).toEqual(['fanin-stop', 'fleet-stop'])
    expect(fanIn.stop).toHaveBeenCalledTimes(1)
    expect(fleet.stop).toHaveBeenCalledTimes(1)
  })
})
