// @vitest-environment node

import { HostAvailabilitySchema, ProjectRefSchema } from '@memon/core'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { CentralProjectUnavailable } from './central-project-unavailable'

describe('CentralProjectUnavailable', () => {
  it('keeps the requested Host and Project visible without stale data', () => {
    const html = renderToStaticMarkup(
      <CentralProjectUnavailable
        project={ProjectRefSchema.parse({ host: 'host-a', project: 'shared-project' })}
        availability={HostAvailabilitySchema.parse({
          host: 'host-a',
          state: 'offline',
          diagnostic: 'Backend request failed',
          lastSuccessfulCheckAt: null,
          centralRelease: '6.0.0',
          backendRelease: null,
          backendRevision: null,
          capabilities: null,
        })}
      />,
    )
    expect(html).toContain('host-a/shared-project')
    expect(html).toContain('data-host-state="offline"')
    expect(html).toContain('No stale Project data')
  })
})
