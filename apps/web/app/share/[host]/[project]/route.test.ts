// @vitest-environment node

import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it } from 'vitest'
import { __resetForTests } from '@/lib/server/auth/rate-limit'
import { GET } from './route'

describe('retired hostless share landing', () => {
  beforeEach(() => __resetForTests())

  it('answers every token with the generic invalid-link page and no cookie', async () => {
    const response = await GET(
      new NextRequest('http://central.internal/share/project-a/Ab12Cd34Ef56Gh78Ij90Kl12', {
        headers: { 'x-forwarded-for': '203.0.113.51' },
      }),
    )
    expect(response.status).toBe(404)
    expect(await response.text()).toContain('Share link invalid or expired')
    expect(response.headers.get('set-cookie')).toBeNull()
  })
})
