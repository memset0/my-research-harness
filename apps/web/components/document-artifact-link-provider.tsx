'use client'

import { useQuery } from '@tanstack/react-query'
import { type ReactNode, useCallback, useMemo } from 'react'
import {
  fetchExperimentsInventory,
  fetchReportsInventory,
  fetchWikiInventory,
  type ProjectTarget,
  projectHost,
  projectName,
  projectQueryKey,
} from '../lib/api'
import type { ArtifactTarget } from '../lib/artifact-links'
import { artifactHref } from '../lib/artifact-navigation'
import { queryKeys } from '../lib/query-keys'
import { MarkdownArtifactLinkProvider } from './markdown'
import { useIsDocumentOnlyViewer } from './session-provider'

export function DocumentArtifactLinkProvider({
  project,
  sourceDocumentPath,
  children,
}: {
  project: ProjectTarget
  sourceDocumentPath?: string
  children: ReactNode
}) {
  // Project inventories are not readable through a document-only share.
  const documentOnly = useIsDocumentOnlyViewer()
  const reportsQuery = useQuery({
    queryKey: queryKeys.reportsInventory(project),
    queryFn: () => fetchReportsInventory(project),
    staleTime: 5_000,
    enabled: !documentOnly,
  })
  const experimentsQuery = useQuery({
    queryKey: queryKeys.experimentsInventory(project),
    queryFn: () => fetchExperimentsInventory(project),
    staleTime: 5_000,
    enabled: !documentOnly,
  })
  const wikiQuery = useQuery({
    queryKey: queryKeys.wikiInventory(project),
    queryFn: () => fetchWikiInventory(project),
    staleTime: 5_000,
    enabled: !documentOnly,
  })
  const inventory = useMemo(
    () => ({
      project: projectName(project),
      host: projectHost(project),
      experiments: (experimentsQuery.data?.items ?? []).map(({ id, resource }) => ({
        id,
        path: resource,
      })),
      reports: (reportsQuery.data?.items ?? []).map(({ id, resource }) => ({
        id,
        path: resource,
      })),
      // `legacyId` carries the `R<NNNN>` of the Report this page replaced, so a
      // stale `R` token still resolves once the Report itself is gone.
      wiki: (wikiQuery.data?.pages ?? []).map(({ id, resource, legacyId }) => ({
        id,
        path: resource,
        legacyId,
      })),
    }),
    [experimentsQuery.data, project, reportsQuery.data, wikiQuery.data],
  )
  const getArtifactHref = useCallback(
    (target: ArtifactTarget) => {
      try {
        return artifactHref(project, target)
      } catch {
        return null
      }
    },
    [project],
  )
  const value = useMemo(
    () => ({
      inventory,
      sourceDocumentPath: sourceDocumentPath ?? '',
      getArtifactHref,
    }),
    [getArtifactHref, inventory, sourceDocumentPath],
  )

  return <MarkdownArtifactLinkProvider value={value}>{children}</MarkdownArtifactLinkProvider>
}
