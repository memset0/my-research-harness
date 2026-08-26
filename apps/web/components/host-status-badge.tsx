import type { HostAvailability, HostAvailabilityState } from '@memon/core'
import { Loader2 } from 'lucide-react'
import { cn } from '../lib/utils'
import { SuccessBadge, WarningBadge } from './colored-badge'
import { Badge } from './ui/badge'

export type HostStatusTone = 'neutral' | 'danger' | 'warning' | 'success'

export interface HostStatusPresentation {
  label: string
  tone: HostStatusTone
  usable: boolean
}

export const HOST_STATUS_PRESENTATION: Readonly<
  Record<HostAvailabilityState, HostStatusPresentation>
> = {
  connecting: { label: 'Connecting', tone: 'neutral', usable: false },
  offline: { label: 'Offline', tone: 'danger', usable: false },
  authentication_failed: {
    label: 'Authentication failed',
    tone: 'danger',
    usable: false,
  },
  identity_mismatch: { label: 'Identity mismatch', tone: 'danger', usable: false },
  misconfigured: { label: 'Misconfigured', tone: 'danger', usable: false },
  filesystem_migration_required: {
    label: 'Filesystem migration required',
    tone: 'warning',
    usable: false,
  },
  upgrade_required: { label: 'Backend upgrade required', tone: 'warning', usable: false },
  central_update_required: {
    label: 'Central update required',
    tone: 'warning',
    usable: false,
  },
  update_available: { label: 'Update available', tone: 'warning', usable: true },
  online: { label: 'Online', tone: 'success', usable: true },
}

export interface HostStatusBadgeProps {
  availability: HostAvailability
  className?: string
}

const RELEASE_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/
const SENSITIVE_DIAGNOSTIC_PATTERN =
  /\b(?:bearer|token|password|secret|ssh|private[ _-]?key|identity[ _-]?file|known[ _-]?hosts|id_(?:rsa|ed25519))\b|\.ssh\//i

function safeRelease(value: string | null): string | null {
  return value && RELEASE_PATTERN.test(value) ? value : null
}

function replaceControlCharacters(value: string): string {
  return Array.from(value, (character) => {
    const code = character.charCodeAt(0)
    return code < 0x20 || code === 0x7f ? ' ' : character
  }).join('')
}

/** Keep server diagnostics tooltip-safe and suppress credential/SSH-shaped details. */
export function safeHostDiagnostic(value: string | null): string | null {
  if (!value) return null
  const normalized = replaceControlCharacters(value)
    .replace(/[<>]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 256)
  if (!normalized) return null
  return SENSITIVE_DIAGNOSTIC_PATTERN.test(normalized)
    ? 'Additional diagnostic details redacted'
    : normalized
}

function statusTitle(availability: HostAvailability, label: string): string {
  const versions: string[] = []
  const backendRelease = safeRelease(availability.backendRelease)
  const centralRelease = safeRelease(availability.centralRelease)
  if (backendRelease) versions.push(`Backend ${backendRelease}`)
  if (centralRelease) versions.push(`central ${centralRelease}`)
  return [
    `${availability.host}: ${label}`,
    versions.length > 0 ? versions.join(', ') : null,
    safeHostDiagnostic(availability.diagnostic),
  ]
    .filter((part): part is string => Boolean(part))
    .join(' · ')
}

export function HostStatusBadge({ availability, className }: HostStatusBadgeProps) {
  const presentation = HOST_STATUS_PRESENTATION[availability.state]
  const common = {
    'aria-label': `${availability.host}: ${presentation.label}; ${presentation.usable ? 'usable' : 'unavailable'}`,
    'data-host-state': availability.state,
    'data-tone': presentation.tone,
    'data-usable': String(presentation.usable),
    title: statusTitle(availability, presentation.label),
  } as const
  const content = (
    <>
      {availability.state === 'connecting' && (
        <Loader2 className="size-2.5 animate-spin" aria-hidden />
      )}
      {presentation.label}
    </>
  )
  const badgeClass = cn('gap-1 font-medium', className)

  switch (presentation.tone) {
    case 'success':
      return (
        <SuccessBadge className={badgeClass} {...common}>
          {content}
        </SuccessBadge>
      )
    case 'warning':
      return (
        <WarningBadge className={badgeClass} {...common}>
          {content}
        </WarningBadge>
      )
    case 'danger':
      return (
        <Badge variant="destructive" className={badgeClass} {...common}>
          {content}
        </Badge>
      )
    case 'neutral':
      return (
        <Badge variant="secondary" className={badgeClass} {...common}>
          {content}
        </Badge>
      )
  }
}
