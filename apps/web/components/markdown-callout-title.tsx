import {
  Archive,
  Bug,
  Check,
  CircleHelp,
  CircleX,
  ClipboardList,
  Info,
  Lightbulb,
  ListTodo,
  Pencil,
  Quote,
  ShieldAlert,
  TriangleAlert,
} from 'lucide-react'
import type { ReactNode } from 'react'

const ICONS = {
  note: Pencil,
  abstract: ClipboardList,
  info: Info,
  todo: ListTodo,
  tip: Lightbulb,
  success: Check,
  question: CircleHelp,
  warning: TriangleAlert,
  failure: CircleX,
  danger: ShieldAlert,
  bug: Bug,
  example: ClipboardList,
  quote: Quote,
  deprecated: Archive,
}

export function MarkdownCalloutTitle({
  kind,
  label,
  children,
}: {
  kind: string
  label?: string
  children: ReactNode
}) {
  const Icon = Object.hasOwn(ICONS, kind) ? ICONS[kind as keyof typeof ICONS] : Pencil
  return (
    <>
      <Icon aria-hidden="true" className="memon-callout-icon" />
      <span className="memon-callout-title-text">
        {label && <span className="memon-callout-label">{label} · </span>}
        {children}
      </span>
    </>
  )
}
