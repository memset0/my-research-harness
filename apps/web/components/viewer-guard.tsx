'use client'

// <ViewerGuard> — wrap a control to render disabled-with-tooltip in viewer mode.
//
// Usage:
//   <ViewerGuard reason="Edit markdown">
//     <Button onClick={...}>Edit markdown</Button>
//   </ViewerGuard>
//
// Owner mode: renders the child unchanged.
// Viewer / anon mode: clones the child, forces `disabled`/`aria-disabled`,
// suppresses the click handler, and wraps in a shadcn Tooltip with the
// "Viewer mode — action disabled" message (plus `reason` if provided).

import { cloneElement, isValidElement, type ReactElement, type ReactNode } from 'react'
import { useSession } from './session-provider'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from './ui/tooltip'

interface ViewerGuardProps {
  /** Short reason shown in the tooltip parenthetical. */
  reason?: string
  /** Additional className to merge on the disabled wrapper. */
  className?: string
  children: ReactNode
}

interface CloneableProps {
  disabled?: boolean
  'aria-disabled'?: boolean
  onClick?: (event: React.MouseEvent) => void
  onPointerDown?: (event: React.PointerEvent) => void
  tabIndex?: number
  className?: string
}

function disableHandler(event: React.SyntheticEvent): void {
  event.preventDefault()
  event.stopPropagation()
}

export function ViewerGuard({ reason, className, children }: ViewerGuardProps) {
  const { role } = useSession()
  if (role === 'owner') {
    // Owner: passthrough.
    return <>{children}</>
  }

  const child = isValidElement(children) ? (children as ReactElement<CloneableProps>) : null
  const tooltipText = reason
    ? `Viewer mode — action disabled (${reason})`
    : 'Viewer mode — action disabled'

  const disabledChild = child ? (
    cloneElement<CloneableProps>(child, {
      disabled: true,
      'aria-disabled': true,
      onClick: disableHandler,
      onPointerDown: disableHandler,
      tabIndex: -1,
      className: [child.props.className, className].filter(Boolean).join(' ') || undefined,
    })
  ) : (
    <span aria-disabled className={className} style={{ opacity: 0.5, pointerEvents: 'none' }}>
      {children}
    </span>
  )

  return (
    <TooltipProvider delayDuration={150}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="inline-flex" style={{ cursor: 'not-allowed' }}>
            {disabledChild}
          </span>
        </TooltipTrigger>
        <TooltipContent side="bottom">{tooltipText}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}
