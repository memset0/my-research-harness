'use client'

import { createContext, type ReactNode, useContext } from 'react'
import type { ChecklistStatusField } from './index'

export interface ChecklistToggle {
  /** Prefer id; bodyLine is retained for id-less static blocks. */
  id: string | null
  bodyLine: number
  payload: string
  path: readonly number[]
  field: ChecklistStatusField
  value: boolean
}

export interface ChecklistWriteContextValue {
  pending: boolean
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
