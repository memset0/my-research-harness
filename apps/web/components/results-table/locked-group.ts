import { cn } from '../../lib/utils'

/**
 * Classes and ARIA state for a control group that cannot be changed (viewer
 * mode or no active View): visibly dimmed and inert.
 */
export function lockedGroupProps(locked: boolean): { className: string; 'aria-disabled': boolean } {
  return {
    className: cn(locked && 'pointer-events-none opacity-70'),
    'aria-disabled': locked,
  }
}
