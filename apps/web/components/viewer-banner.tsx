'use client'

// Persistent banner shown across the dashboard when the active session is a
// viewer. Identifies the scope set and offers a "Log in as owner" link.
// Dismissible per browser tab via sessionStorage; reappears on tab reload.

import { useEffect, useState } from 'react'
import { usePathname } from 'next/navigation'
import Link from 'next/link'
import { Eye, X } from 'lucide-react'
import { useSession } from './session-provider'

const DISMISS_KEY = 'memon:viewer-banner:dismissed'

export function ViewerBanner() {
  const { role, scopeProjects, scopeProjectRefs } = useSession()
  const pathname = usePathname() ?? '/'
  const [dismissed, setDismissed] = useState(false)

  useEffect(() => {
    try {
      const v = sessionStorage.getItem(DISMISS_KEY)
      if (v === '1') setDismissed(true)
    } catch {
      // sessionStorage unavailable; show the banner.
    }
  }, [])

  if (role !== 'viewer') return null
  if (dismissed) return null

  const projects =
    scopeProjectRefs && scopeProjectRefs.length > 0
      ? scopeProjectRefs.map((scope) => `${scope.host}/${scope.project}`).join(', ')
      : scopeProjects.join(', ') || '(no projects)'
  const loginHref = `/login?next=${encodeURIComponent(pathname)}`

  const onDismiss = () => {
    try {
      sessionStorage.setItem(DISMISS_KEY, '1')
    } catch {
      // ignore
    }
    setDismissed(true)
  }

  return (
    <div className="border-b border-amber-500/40 bg-amber-500/10 text-amber-900 dark:text-amber-200">
      <div className="mx-auto flex max-w-screen-2xl items-center gap-3 px-4 py-2 text-sm">
        <Eye className="size-4 shrink-0" />
        <span className="flex-1">
          Viewer mode — read-only access to <code className="font-mono">{projects}</code>.{' '}
          <Link href={loginHref} className="font-medium underline underline-offset-2">
            Log in as owner
          </Link>{' '}
          to access write actions.
        </span>
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss viewer-mode banner"
          className="shrink-0 rounded p-1 hover:bg-amber-500/20"
        >
          <X className="size-3.5" />
        </button>
      </div>
    </div>
  )
}
