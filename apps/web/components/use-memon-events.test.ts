// @vitest-environment node

import { QueryClient } from '@tanstack/react-query'
import { describe, expect, it } from 'vitest'
import {
  invalidateJournalQueries,
  invalidateQueriesForHost,
  queryKeyContainsHost,
} from './use-memon-events'

describe('Host-scoped live-update invalidation', () => {
  it('recognizes Host identity in positional and structured query keys', () => {
    expect(queryKeyContainsHost(['run', 'host-a', 'run-1'], 'host-a')).toBe(true)
    expect(
      queryKeyContainsHost(['report', { ref: { host: 'host-a', project: 'project-x' } }], 'host-a'),
    ).toBe(true)
    expect(queryKeyContainsHost(['run', 'host-b', 'run-1'], 'host-a')).toBe(false)
  })

  it('invalidates only the selected Host plus aggregate hosts/projects', () => {
    const queryClient = new QueryClient()
    const hostAKey = ['run', 'host-a', 'run-1'] as const
    const hostAObjectKey = ['report', { host: 'host-a', project: 'project-x' }] as const
    const hostBKey = ['run', 'host-b', 'run-1'] as const
    const hostsKey = ['hosts'] as const
    const projectsKey = ['projects'] as const
    const unrelatedKey = ['theme'] as const
    for (const key of [hostAKey, hostAObjectKey, hostBKey, hostsKey, projectsKey, unrelatedKey]) {
      queryClient.setQueryData(key, { ok: true })
    }

    invalidateQueriesForHost(queryClient, 'host-a')

    const invalidated = (key: readonly unknown[]) =>
      queryClient.getQueryState(key)?.isInvalidated ?? false
    expect(invalidated(hostAKey)).toBe(true)
    expect(invalidated(hostAObjectKey)).toBe(true)
    expect(invalidated(hostsKey)).toBe(true)
    expect(invalidated(projectsKey)).toBe(true)
    expect(invalidated(hostBKey)).toBe(false)
    expect(invalidated(unrelatedKey)).toBe(false)
  })

  it('invalidates only the exact Host-qualified journal key', () => {
    const queryClient = new QueryClient()
    const hostA = ['journal', 'host-a', 'project-x'] as const
    const hostB = ['journal', 'host-b', 'project-x'] as const
    const otherProject = ['journal', 'host-a', 'project-y'] as const
    for (const key of [hostA, hostB, otherProject]) queryClient.setQueryData(key, { ok: true })

    invalidateJournalQueries(queryClient, 'host-a', 'project-x')

    expect(queryClient.getQueryState(hostA)?.isInvalidated).toBe(true)
    expect(queryClient.getQueryState(hostB)?.isInvalidated).toBe(false)
    expect(queryClient.getQueryState(otherProject)?.isInvalidated).toBe(false)
  })
})
