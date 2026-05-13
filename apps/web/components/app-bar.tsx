'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { PROJECT_SCOPE_SLUG } from '../lib/api'
import { Button } from './ui/button'
import { SidebarTrigger } from './ui/sidebar'
import { OpenWithButton } from './open-with-button'
import { TabBadge, type TabKind } from './tab-badge'

interface TabSpec {
  name: string
  kind: TabKind
  href: string
  matches: (p: string) => boolean
}

export function AppBar({ project }: { project: string }) {
  const pathname = usePathname() ?? ''
  const projectBase = `/p/${encodeURIComponent(project)}`
  const tabs: TabSpec[] = [
    {
      name: 'Experiments',
      kind: 'experiments',
      href: projectBase,
      // Active for the project root, v3 exp-doc detail (`/e/<id>`), the
      // legacy v2 detail (`/experiments/<id>`), and the legacy run URL
      // (`/r/<id>`) which permanent-redirects to `/e/<id>` — including
      // it here keeps the highlight stable across the redirect. Each
      // sub-segment match uses a trailing `/` so a hypothetical sibling
      // segment (`/eats`, `/reports`) cannot false-positive.
      matches: (p) =>
        p === projectBase ||
        p.startsWith(`${projectBase}/e/`) ||
        p.startsWith(`${projectBase}/r/`) ||
        p.startsWith(`${projectBase}/experiments/`) ||
        p === `${projectBase}/experiments`,
    },
    {
      name: 'Hypotheses',
      kind: 'hypotheses',
      href: `${projectBase}/hypotheses`,
      matches: (p) => p.startsWith(`${projectBase}/hypotheses`),
    },
    {
      name: 'Journal',
      kind: 'journal',
      href: `${projectBase}/journal`,
      matches: (p) => p.startsWith(`${projectBase}/journal`),
    },
    {
      name: 'Reports',
      kind: 'reports',
      href: `${projectBase}/reports`,
      matches: (p) => p.startsWith(`${projectBase}/reports`),
    },
    {
      name: 'Digests',
      kind: 'digests',
      href: `${projectBase}/digests`,
      matches: (p) => p.startsWith(`${projectBase}/digests`),
    },
  ]

  return (
    <header className="sticky top-0 z-20 flex min-h-12 shrink-0 items-center gap-2 border-b bg-background px-3 py-1.5 md:px-4">
      <SidebarTrigger className="md:hidden" />
      {/*
        nav: do NOT add overflow-x-auto here. Per CSS spec, setting
        overflow-x to a non-visible value makes overflow-y auto as well,
        and shadcn Button's `active:translate-y-px` (1px nudge on click)
        then makes content overflow vertically by 1px → stray scrollbar.

        flex-1 + min-w-0 lets the nav constrain to the row's remaining
        width (after the SidebarTrigger) so flex-wrap can actually
        kick in when the tab list is wider than that — without
        min-w-0, flex's default min-width:auto keeps the nav at
        intrinsic content width and overflow goes back to the page.
      */}
      <nav className="flex flex-1 flex-wrap items-center gap-1 min-w-0" role="tablist">
        {tabs.map((t) => {
          const isActive = t.matches(pathname)
          return (
            <Button
              key={t.href}
              asChild
              size="sm"
              variant={isActive ? 'default' : 'ghost'}
            >
              <Link href={t.href} role="tab" aria-selected={isActive}>
                <span>{t.name}</span>
                <TabBadge kind={t.kind} project={project} active={isActive} />
              </Link>
            </Button>
          )
        })}
      </nav>
      <OpenWithButton project={project} scope="project" slug={PROJECT_SCOPE_SLUG} />
    </header>
  )
}
