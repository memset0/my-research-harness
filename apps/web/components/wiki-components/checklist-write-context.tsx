'use client'

/**
 * Write path for `checklist@1` toggles.
 *
 * The provider is mounted by the wiki reading surfaces only. Anywhere else
 * the context is absent and the renderer shows disabled, read-only controls.
 * The provider does not know about React Query or toasts itself - the wiki
 * surface injects the persistence callback so the source of truth (the page
 * file, guarded by mtime/hash) stays in one place.
 */

import { createContext, useContext, type ReactNode } from 'react'
import type { ChecklistStatusField } from '../../lib/wiki-components/checklist@1'

export interface ChecklistToggle {
  /** 1-based opening-fence line, relative to the rendered Markdown body. */
  bodyLine: number
  /** Payload of the block as rendered. */
  payload: string
  path: readonly number[]
  field: ChecklistStatusField
  value: boolean
}

export interface ChecklistWriteContextValue {
  /** True while a toggle is in flight; every checklist control is disabled. */
  pending: boolean
  /** Non-null when the surface knows writes are impossible (viewer session). */
  readOnlyReason: string | null
  toggle: (edit: ChecklistToggle) => void
}

const ChecklistWriteContext = createContext<ChecklistWriteContextValue | null>(null)

export function ChecklistWriteProvider({
  value,
  children,
}: {
  value: ChecklistWriteContextValue
  children: ReactNode
}) {
  return <ChecklistWriteContext.Provider value={value}>{children}</ChecklistWriteContext.Provider>
}

export function useChecklistWrite(): ChecklistWriteContextValue | null {
  return useContext(ChecklistWriteContext)
}
