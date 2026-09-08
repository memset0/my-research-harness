import type { HostAvailability, HostAvailabilityState } from '@memon/core'
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { HOST_STATUS_PRESENTATION, HostStatusBadge, safeHostDiagnostic } from './host-status-badge'

const CAPABILITIES = {
  projects: true,
  mutations: true,
  events: true,
  logStreaming: true,
  reportAssets: true,
  wikiAssets: true,
  git: true,
  shares: true,
  slurm: false,
}

function availability(state: HostAvailabilityState): HostAvailability {
  return {
    host: 'host-a' as HostAvailability['host'],
    state,
    diagnostic: state === 'online' ? null : 'Backend is unavailable',
    lastSuccessfulCheckAt: '2026-08-26T17:00:00.000Z',
    centralRelease: '6.1.0' as HostAvailability['centralRelease'],
    backendRelease: '6.0.0' as HostAvailability['backendRelease'],
    backendRevision: '0123456789abcdef' as HostAvailability['backendRevision'],
    capabilities: CAPABILITIES,
  }
}

describe('HostStatusBadge', () => {
  it.each(
    Object.entries(HOST_STATUS_PRESENTATION),
  )('renders explicit accessible state %s', (state, presentation) => {
    render(<HostStatusBadge availability={availability(state as HostAvailabilityState)} />)
    const badge = screen.getByText(presentation.label)
    expect(badge).toHaveAttribute('data-host-state', state)
    expect(badge).toHaveAttribute('data-tone', presentation.tone)
    expect(badge).toHaveAttribute('data-usable', String(presentation.usable))
    expect(badge).toHaveAccessibleName(
      `host-a: ${presentation.label}; ${presentation.usable ? 'usable' : 'unavailable'}`,
    )
    expect(badge).toHaveAttribute('title', expect.stringContaining('Backend 6.0.0'))
    expect(badge).toHaveAttribute('title', expect.stringContaining('central 6.1.0'))
  })

  it('distinguishes exactly online and update-available as usable', () => {
    const usable = Object.entries(HOST_STATUS_PRESENTATION)
      .filter(([, presentation]) => presentation.usable)
      .map(([state]) => state)
    expect(usable).toEqual(['update_available', 'online'])
  })

  it('shows the existing semantic spinner treatment only while connecting', () => {
    const { container } = render(<HostStatusBadge availability={availability('connecting')} />)
    const spinner = container.querySelector('svg')
    expect(spinner).toHaveClass('animate-spin')
    expect(spinner).toHaveAttribute('aria-hidden')
  })

  it('keeps diagnostics tooltip-safe and never renders token or SSH material', () => {
    const secret = 'top-secret-token-value'
    const unsafe = {
      ...availability('authentication_failed'),
      diagnostic: `Bearer ${secret}; SSH user@private; <script>alert(1)</script>`,
      token: secret,
      sshTarget: 'user@private',
    } as HostAvailability
    const { container } = render(<HostStatusBadge availability={unsafe} />)
    const badge = screen.getByText('Authentication failed')

    expect(badge.title).toContain('Additional diagnostic details redacted')
    expect(container.innerHTML).not.toContain(secret)
    expect(container.innerHTML.toLowerCase()).not.toContain('ssh')
    expect(container.innerHTML).not.toContain('user@private')
    expect(safeHostDiagnostic('Healthy\nstatus')).toBe('Healthy status')
  })
})
