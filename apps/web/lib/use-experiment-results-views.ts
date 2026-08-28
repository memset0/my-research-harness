'use client'

import { type SetStateAction, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSession } from '../components/session-provider'
import type { ProjectTarget } from './api'
import {
  type ExperimentResultsView,
  type ExperimentResultsViewDefinition,
  type ExperimentResultsViewsResponse,
  resultsViewLegacyPreferenceKey,
  resultsViewLocalScopeKey,
  resultsViewScope,
  resultsViewScopeSearch,
} from './experiment-results-views'

interface DirtyView {
  version: 1
  mutationId: string
  definition: ExperimentResultsViewDefinition
}

export interface ExperimentResultsViewsState {
  views: ExperimentResultsView[]
  activeView: ExperimentResultsView | null
  definition: ExperimentResultsViewDefinition
  canMutate: boolean
  loading: boolean
  error: string | null
  selectView: (id: string) => void
  updateDefinition: (next: SetStateAction<ExperimentResultsViewDefinition>) => void
  createView: (name: string) => Promise<ExperimentResultsView>
  renameView: (id: string, name: string) => Promise<ExperimentResultsView>
  deleteView: (id: string) => Promise<void>
}

const writeChains = new Map<string, Promise<ExperimentResultsView>>()
let mutationSequence = 0
const PROVISIONAL_VIEW_ID = 'local-default'

export function useExperimentResultsViews(
  project: ProjectTarget,
  experimentId: string,
  initial: ExperimentResultsViewDefinition,
): ExperimentResultsViewsState {
  const session = useSession()
  const scope = useMemo(() => resultsViewScope(project, experimentId), [project, experimentId])
  const scopeSearch = useMemo(() => resultsViewScopeSearch(scope), [scope])
  const localBase = useMemo(() => resultsViewLocalScopeKey(scope), [scope])
  const [views, setViews] = useState<ExperimentResultsView[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const viewsRef = useRef(views)
  const activeIdRef = useRef(activeId)
  const generationRef = useRef(0)
  viewsRef.current = views
  activeIdRef.current = activeId

  const canMutate = session.role === 'owner'
  const activeView = views.find((view) => view.id === activeId) ?? null
  const definition = activeView?.definition ?? initial

  const persistCollection = useCallback(
    (nextViews: ExperimentResultsView[], nextActiveId: string | null) => {
      writeLocalJson(collectionKey(localBase), nextViews)
      if (nextActiveId) writeLocalText(activeKey(localBase), nextActiveId)
      else removeLocal(activeKey(localBase))
    },
    [localBase],
  )

  const install = useCallback(
    (nextViews: ExperimentResultsView[], preferredActiveId?: string | null) => {
      const selected =
        nextViews.find((view) => view.id === preferredActiveId)?.id ?? nextViews[0]?.id ?? null
      viewsRef.current = nextViews
      activeIdRef.current = selected
      setViews(nextViews)
      setActiveId(selected)
      persistCollection(nextViews, selected)
    },
    [persistCollection],
  )

  const enqueueDefinitionWrite = useCallback(
    (viewId: string, nextDefinition: ExperimentResultsViewDefinition, mutationId: string) => {
      const chainKey = `${localBase}\0${viewId}`
      const previous = writeChains.get(chainKey) ?? Promise.resolve(null)
      const request = previous
        .catch(() => null)
        .then(async () => {
          const response = await fetch(
            `/api/experiment-results-views/${encodeURIComponent(viewId)}?${scopeSearch}`,
            {
              method: 'PATCH',
              cache: 'no-store',
              credentials: 'same-origin',
              keepalive: true,
              headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
              body: JSON.stringify({ definition: nextDefinition }),
            },
          )
          if (!response.ok) throw new Error(await responseError(response, 'Failed to save View'))
          const body = (await response.json()) as { view: ExperimentResultsView }
          return body.view
        })

      let tracked: Promise<ExperimentResultsView>
      tracked = request
        .then((saved) => {
          const dirty = readLocalJson<DirtyView>(dirtyKey(localBase, viewId))
          const current = viewsRef.current.find((view) => view.id === viewId)
          if (dirty?.mutationId !== mutationId || !current) return saved
          const nextViews = viewsRef.current.map((view) =>
            view.id === viewId ? { ...saved, definition: current.definition } : view,
          )
          removeLocal(dirtyKey(localBase, viewId))
          viewsRef.current = nextViews
          setViews(nextViews)
          persistCollection(nextViews, activeIdRef.current)
          return saved
        })
        .catch((caught) => {
          setError(caught instanceof Error ? caught.message : 'Failed to save View')
          throw caught
        })
        .finally(() => {
          if (writeChains.get(chainKey) === tracked) writeChains.delete(chainKey)
        })
      writeChains.set(chainKey, tracked)
      void tracked.catch(() => undefined)
    },
    [localBase, persistCollection, scopeSearch],
  )

  useEffect(() => {
    const generation = generationRef.current + 1
    generationRef.current = generation
    setLoading(true)
    setError(null)

    const cachedViews = readLocalJson<ExperimentResultsView[]>(collectionKey(localBase))
    const preferredActiveId = readLocalText(activeKey(localBase))
    if (Array.isArray(cachedViews) && cachedViews.length > 0) {
      install(cachedViews, preferredActiveId)
    } else if (canMutate) {
      const legacy =
        readLocalJson<ExperimentResultsViewDefinition>(resultsViewLegacyPreferenceKey(scope)) ??
        initial
      install(
        [
          {
            id: PROVISIONAL_VIEW_ID,
            scope,
            name: 'Default',
            definition: legacy,
            revision: 0,
            createdAt: 0,
            updatedAt: 0,
          },
        ],
        PROVISIONAL_VIEW_ID,
      )
    }

    void fetch(`/api/experiment-results-views?${scopeSearch}`, {
      cache: 'no-store',
      credentials: 'same-origin',
      headers: { Accept: 'application/json' },
    })
      .then(async (response) => {
        if (!response.ok) throw new Error(await responseError(response, 'Failed to load Views'))
        return (await response.json()) as ExperimentResultsViewsResponse
      })
      .then(async (payload) => {
        if (generation !== generationRef.current) return
        let serverViews = payload.views

        if (serverViews.length === 0 && canMutate) {
          const legacy = readLocalJson<ExperimentResultsViewDefinition>(
            resultsViewLegacyPreferenceKey(scope),
          )
          const seed =
            viewsRef.current.find((view) => view.id === PROVISIONAL_VIEW_ID)?.definition ??
            legacy ??
            initial
          const response = await fetch(`/api/experiment-results-views?${scopeSearch}`, {
            method: 'POST',
            cache: 'no-store',
            credentials: 'same-origin',
            headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
            body: JSON.stringify({ name: 'Default', definition: seed }),
          })
          if (!response.ok) {
            throw new Error(await responseError(response, 'Failed to create the default View'))
          }
          const created = (await response.json()) as { view: ExperimentResultsView }
          serverViews = [created.view]
          removeLocal(dirtyKey(localBase, PROVISIONAL_VIEW_ID))
        }

        const provisionalDirty = canMutate
          ? readLocalJson<DirtyView>(dirtyKey(localBase, PROVISIONAL_VIEW_ID))
          : null
        const hydrated = serverViews.map((serverView) => {
          if (!canMutate) return serverView
          const dirty = readLocalJson<DirtyView>(dirtyKey(localBase, serverView.id))
          const causallyNewer = dirty ?? (serverView === serverViews[0] ? provisionalDirty : null)
          if (!causallyNewer) return serverView
          if (!dirty) {
            writeLocalJson(dirtyKey(localBase, serverView.id), causallyNewer)
            removeLocal(dirtyKey(localBase, PROVISIONAL_VIEW_ID))
          }
          enqueueDefinitionWrite(serverView.id, causallyNewer.definition, causallyNewer.mutationId)
          return { ...serverView, definition: causallyNewer.definition }
        })
        install(hydrated, preferredActiveId)
      })
      .catch((caught) => {
        if (generation !== generationRef.current) return
        setError(caught instanceof Error ? caught.message : 'Failed to load Views')
      })
      .finally(() => {
        if (generation === generationRef.current) setLoading(false)
      })

    return () => {
      if (generationRef.current === generation) generationRef.current += 1
    }
  }, [canMutate, enqueueDefinitionWrite, initial, install, localBase, scope, scopeSearch])

  const selectView = useCallback(
    (id: string) => {
      if (!viewsRef.current.some((view) => view.id === id)) return
      activeIdRef.current = id
      setActiveId(id)
      writeLocalText(activeKey(localBase), id)
    },
    [localBase],
  )

  const updateDefinition = useCallback(
    (action: SetStateAction<ExperimentResultsViewDefinition>) => {
      if (!canMutate || !activeIdRef.current) return
      const viewId = activeIdRef.current
      const current = viewsRef.current.find((view) => view.id === viewId)
      if (!current) return
      const next =
        typeof action === 'function'
          ? (action as (value: ExperimentResultsViewDefinition) => ExperimentResultsViewDefinition)(
              current.definition,
            )
          : action
      if (serialize(next) === serialize(current.definition)) return

      const mutationId = nextMutationId()
      const nextViews = viewsRef.current.map((view) =>
        view.id === viewId ? { ...view, definition: next } : view,
      )
      viewsRef.current = nextViews
      setViews(nextViews)
      writeLocalJson<DirtyView>(dirtyKey(localBase, viewId), {
        version: 1,
        mutationId,
        definition: next,
      })
      persistCollection(nextViews, viewId)
      writeLocalJson(resultsViewLegacyPreferenceKey(scope), next)
      if (viewId !== PROVISIONAL_VIEW_ID) {
        enqueueDefinitionWrite(viewId, next, mutationId)
      }
    },
    [canMutate, enqueueDefinitionWrite, localBase, persistCollection, scope],
  )

  const createView = useCallback(
    async (name: string) => {
      if (!canMutate) throw new Error('Viewer mode cannot create Views')
      const active = viewsRef.current.find((view) => view.id === activeIdRef.current)
      const response = await fetch(`/api/experiment-results-views?${scopeSearch}`, {
        method: 'POST',
        cache: 'no-store',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ name, definition: active?.definition ?? initial }),
      })
      if (!response.ok) throw new Error(await responseError(response, 'Failed to create View'))
      const { view } = (await response.json()) as { view: ExperimentResultsView }
      install([...viewsRef.current, view], view.id)
      return view
    },
    [canMutate, initial, install, scopeSearch],
  )

  const renameView = useCallback(
    async (id: string, name: string) => {
      if (!canMutate) throw new Error('Viewer mode cannot rename Views')
      const response = await fetch(
        `/api/experiment-results-views/${encodeURIComponent(id)}?${scopeSearch}`,
        {
          method: 'PATCH',
          cache: 'no-store',
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify({ name }),
        },
      )
      if (!response.ok) throw new Error(await responseError(response, 'Failed to rename View'))
      const { view } = (await response.json()) as { view: ExperimentResultsView }
      const nextViews = viewsRef.current.map((candidate) =>
        candidate.id === id ? { ...view, definition: candidate.definition } : candidate,
      )
      install(nextViews, activeIdRef.current)
      return view
    },
    [canMutate, install, scopeSearch],
  )

  const deleteView = useCallback(
    async (id: string) => {
      if (!canMutate) throw new Error('Viewer mode cannot delete Views')
      const response = await fetch(
        `/api/experiment-results-views/${encodeURIComponent(id)}?${scopeSearch}`,
        {
          method: 'DELETE',
          cache: 'no-store',
          credentials: 'same-origin',
        },
      )
      if (!response.ok) throw new Error(await responseError(response, 'Failed to delete View'))
      removeLocal(dirtyKey(localBase, id))
      install(
        viewsRef.current.filter((view) => view.id !== id),
        activeIdRef.current === id ? null : activeIdRef.current,
      )
    },
    [canMutate, install, localBase, scopeSearch],
  )

  return {
    views,
    activeView,
    definition,
    canMutate,
    loading,
    error,
    selectView,
    updateDefinition,
    createView,
    renameView,
    deleteView,
  }
}

function collectionKey(base: string): string {
  return `${base}:collection`
}

function activeKey(base: string): string {
  return `${base}:active`
}

function dirtyKey(base: string, id: string): string {
  return `${base}:dirty:${id}`
}

function nextMutationId(): string {
  mutationSequence += 1
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${mutationSequence}`
}

function serialize(value: unknown): string | null {
  try {
    return JSON.stringify(value)
  } catch {
    return null
  }
}

function readLocalText(key: string): string | null {
  if (typeof window === 'undefined') return null
  try {
    return window.localStorage.getItem(key)
  } catch {
    return null
  }
}

function readLocalJson<T>(key: string): T | null {
  const raw = readLocalText(key)
  if (raw === null) return null
  try {
    return JSON.parse(raw) as T
  } catch {
    return null
  }
}

function writeLocalText(key: string, value: string): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(key, value)
  } catch {
    // SQLite remains authoritative when browser storage is unavailable.
  }
}

function writeLocalJson<T>(key: string, value: T): void {
  const serialized = serialize(value)
  if (serialized !== null) writeLocalText(key, serialized)
}

function removeLocal(key: string): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.removeItem(key)
  } catch {
    // Nothing else can be done when browser storage is unavailable.
  }
}

async function responseError(response: Response, fallback: string): Promise<string> {
  try {
    const body = (await response.json()) as { error?: { message?: string } }
    return body.error?.message ?? fallback
  } catch {
    return fallback
  }
}
