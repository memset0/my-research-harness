'use client'

import { useQuery } from '@tanstack/react-query'
import { usePathname, useSearchParams } from 'next/navigation'
import { type ReactNode, useCallback, useMemo } from 'react'
import {
  fetchExperimentDocs,
  fetchReports,
  fetchWiki,
  type ProjectTarget,
  projectHost,
  projectName,
  projectQueryKey,
} from '../lib/api'
import type { ArtifactTarget } from '../lib/artifact-links'
import { buildArtifactNavigationHref } from '../lib/report-workspace-url'
import { MarkdownArtifactLinkProvider, type MarkdownArtifactSourceSurface } from './markdown'

export function DocumentArtifactLinkProvider({
  project,
  sourceDocumentPath,
  sourceSurface,
  sourceReportId,
  children,
}: {
  project: ProjectTarget
  sourceDocumentPath?: string
  sourceSurface: MarkdownArtifactSourceSurface
  sourceReportId?: string
  children: ReactNode
}) {
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const reportsQuery = useQuery({
    queryKey: ['reports', ...projectQueryKey(project)],
    queryFn: () => fetchReports(project),
    staleTime: 5_000,
  })
  const experimentsQuery = useQuery({
    queryKey: ['experiments', ...projectQueryKey(project)],
    queryFn: () => fetchExperimentDocs(project),
    staleTime: 5_000,
  })
  const wikiQuery = useQuery({
    queryKey: ['wiki', ...projectQueryKey(project)],
    queryFn: () => fetchWiki(project),
    staleTime: 5_000,
  })
  const currentHref = useMemo(() => {
    const search = searchParams?.toString() ?? ''
    return `${pathname ?? '/'}${search ? `?${search}` : ''}`
  }, [pathname, searchParams])
  const inventory = useMemo(
    () => ({
      project: projectName(project),
      host: projectHost(project),
      experiments: (experimentsQuery.data?.experiments ?? []).flatMap(({ id, path, resource }) =>
        (path ?? resource) ? [{ id, path: (path ?? resource)! }] : [],
      ),
      reports: (reportsQuery.data?.reports ?? []).flatMap(({ id, path, resource }) =>
        (path ?? resource) ? [{ id, path: (path ?? resource)! }] : [],
      ),
      // `legacyId` carries the `R<NNNN>` of the Report this page replaced, so a
      // stale `R` token still resolves once the Report itself is gone.
      wiki: (wikiQuery.data?.pages ?? []).map(({ id, path, resource, legacyId }) => ({
        id,
        path: path ?? resource ?? '',
        legacyId,
      })),
    }),
    [experimentsQuery.data, project, reportsQuery.data, wikiQuery.data],
  )
  const getArtifactHref = useCallback(
    (target: ArtifactTarget, activeSourceSurface: MarkdownArtifactSourceSurface) => {
      try {
        return buildArtifactNavigationHref({
          sourceSurface: activeSourceSurface,
          target,
          project,
          currentHref,
          sourceReportId,
        })
      } catch {
        return null
      }
    },
    [currentHref, project, sourceReportId],
  )
  const value = useMemo(
    () => ({
      inventory,
      sourceDocumentPath: sourceDocumentPath ?? '',
      sourceSurface,
      getArtifactHref,
    }),
    [getArtifactHref, inventory, sourceDocumentPath, sourceSurface],
  )

  return <MarkdownArtifactLinkProvider value={value}>{children}</MarkdownArtifactLinkProvider>
}
