// @vitest-environment node

import { NextRequest } from 'next/server'
import { describe, expect, it } from 'vitest'
import { GET } from './route'

function request(path: string): NextRequest {
  return new NextRequest(`http://central.internal${path}`, {
    headers: {
      'x-forwarded-for': '203.0.113.50',
      'x-forwarded-host': 'memon.example.test',
      'x-forwarded-proto': 'https',
    },
  })
}

function context(host: string, project: string, token: string) {
  return { params: Promise.resolve({ host, project, token }) }
}

const TOKEN = 'Ab12Cd34Ef56Gh78Ij90Kl12'

describe('earlier Host-qualified share URL', () => {
  it('redirects to the Project page carrying the token and sets no cookie', async () => {
    const response = await GET(
      request(`/share/host-a/shared-project/${TOKEN}`),
      context('host-a', 'shared-project', TOKEN),
    )
    expect(response.status).toBe(302)
    expect(response.headers.get('location')).toBe(
      `https://memon.example.test/host-a/shared-project?share=${TOKEN}`,
    )
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(response.headers.get('set-cookie')).toBeNull()
  })

  it('keeps equal Project names on different Hosts apart', async () => {
    const response = await GET(
      request(`/share/host-b/shared-project/${TOKEN}`),
      context('host-b', 'shared-project', TOKEN),
    )
    expect(response.headers.get('location')).toBe(
      `https://memon.example.test/host-b/shared-project?share=${TOKEN}`,
    )
  })

  it('answers the generic invalid-link page for malformed segments', async () => {
    for (const [host, project, token] of [
      ['Host-A', 'shared-project', TOKEN],
      ['host-a', 'shared/project', TOKEN],
      ['host-a', 'shared-project', 'bad.token'],
    ] as const) {
      const response = await GET(request('/share/x/y/z'), context(host, project, token))
      expect(response.status).toBe(404)
      expect(await response.text()).toContain('Share link invalid or expired')
      expect(response.headers.get('set-cookie')).toBeNull()
    }
  })
})
