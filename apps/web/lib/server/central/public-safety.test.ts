// @vitest-environment node

import type { CentralConfig } from '@memon/core'
import { describe, expect, it } from 'vitest'
import { buildBrowserResponseHeaders } from './backend-headers'
import { CentralHostRegistry } from './host-registry'
import { redactOperationalText, safeLogRecord } from './public-safety'

const TOKEN = 'synthetic_backend_token_aaaaaaaaaaaa'
const SESSION_SECRET = 'synthetic_session_secret_bbbbbbbbb'
const PRIVATE_KEY = '/synthetic/private/id_backend'
const KNOWN_HOSTS = '/synthetic/private/known_hosts'
const CLUSTER_PATH = '/synthetic/cluster/project-a/runs/run-a'

describe('central public and diagnostic redaction', () => {
  it('redacts tokens, auth challenges, absolute paths, and session secrets from log records', () => {
    const record = safeLogRecord(
      'error',
      `failure ${TOKEN} ${SESSION_SECRET} ${CLUSTER_PATH} Bearer private-challenge`,
      [TOKEN, SESSION_SECRET],
    )
    const serialized = JSON.stringify(record)
    for (const forbidden of [TOKEN, SESSION_SECRET, CLUSTER_PATH, 'private-challenge']) {
      expect(serialized).not.toContain(forbidden)
    }
    expect(serialized).not.toContain('stack')
  })

  it('redacts private SSH details and tokens from Host status diagnostics', () => {
    const config: CentralConfig = {
      bindAddr: '127.0.0.1',
      bindPort: 3737,
      hosts: [
        {
          id: 'host-a',
          tokens: { current: TOKEN },
          transport: {
            kind: 'ssh',
            executable: 'ssh',
            target: 'tunnel@private.example',
            knownHostsFile: KNOWN_HOSTS,
            identityFile: PRIVATE_KEY,
            localPort: 4738,
            remoteHost: '127.0.0.1',
            remotePort: 3738,
          },
        },
      ],
    }
    const registry = new CentralHostRegistry(config)
    const status = registry.markFailure(
      'host-a',
      'offline',
      `SSH ${TOKEN} ${PRIVATE_KEY} ${KNOWN_HOSTS} ${CLUSTER_PATH}`,
    )
    const serialized = JSON.stringify(status)
    for (const forbidden of [TOKEN, PRIVATE_KEY, KNOWN_HOSTS, CLUSTER_PATH])
      expect(serialized).not.toContain(forbidden)
  })

  it('never relays Backend challenges, cookies, redirects, or private headers to a browser', () => {
    const headers = buildBrowserResponseHeaders(
      new Headers({
        'www-authenticate': 'Bearer backend-private',
        'set-cookie': `secret=${SESSION_SECRET}`,
        location: 'https://private.example/internal',
        'x-memon-private': PRIVATE_KEY,
        'content-type': 'application/json',
      }),
    )
    expect(headers.get('content-type')).toBe('application/json')
    for (const name of ['www-authenticate', 'set-cookie', 'location', 'x-memon-private'])
      expect(headers.get(name)).toBeNull()
  })

  it('bounds arbitrary diagnostic text', () => {
    expect(redactOperationalText('x'.repeat(10_000)).length).toBe(512)
  })
})
