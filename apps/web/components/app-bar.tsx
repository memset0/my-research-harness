'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { type ProjectTarget, projectWebPath } from '../lib/api'
import { ManageSharesDialog } from './manage-shares-dialog'
import { TabBadge, type TabKind } from './tab-badge'
import { Button } from './ui/button'
import { SidebarTrigger } from './ui/sidebar'

interface TabSpec {
  name: string
  kind: TabKind
  href: string
  matches: (p: string) => boolean
}

export function AppBar({ project }: { project: ProjectTarget }) {
  const pathname = usePathname() ?? ''
  const projectBase = projectWebPath(project)
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
    {
      name: 'Code Review',
      kind: 'code-review',
      href: `${projectBase}/code-review`,
      matches: (p) => p.startsWith(`${projectBase}/code-review`),
    },
    {
      name: 'Wiki',
      kind: 'wiki',
      href: `${projectBase}/wiki`,
      matches: (p) => p.startsWith(`${projectBase}/wiki`),
    },
  ]

  return (
    <header className="sticky top-0 z-20 flex min-h-12 shrink-0 items-center gap-2 border-b bg-background px-3 py-1.5 md:px-4">
      {/* Fixed leading control: visible at every viewport. Mobile users see
          this as the only drawer affordance; desktop users use it to
          collapse the sidebar into offcanvas (Cmd/Ctrl+B does the same).
          It stays pinned on the left and is NOT part of the wrap flow
          below — it never reflows with the tabs / right controls. */}
      <SidebarTrigger />
      {/*
        Shared wrap flow for the nav tabs + right-side controls ONLY (the
        SidebarTrigger above is deliberately excluded). This inner wrapper
        is flex-1 + min-w-0 so it claims the row's remaining width (after
        the trigger) and its own flex-wrap kicks in when the items are wider
        than that; without min-w-0, flex's default min-width:auto would keep
        it at intrinsic width and overflow the page instead of wrapping.

        The <nav> uses `display: contents` so its tab buttons participate
        directly in this wrapper's flex flow (filling from the left), while
        the role="tablist" grouping stays in the a11y tree. The right-side
        control group carries ml-auto so it right-aligns on whatever line it
        lands on — so on the final (shared or trailing) line the trailing
        tab(s) hug left and the controls hug right.

        do NOT add overflow-x-auto anywhere here. Per CSS spec, overflow-x
        to a non-visible value makes overflow-y auto too, and shadcn
        Button's `active:translate-y-px` (1px click nudge) then overflows
        vertically by 1px → stray scrollbar. Wrapping (flex-wrap) is the
        overflow strategy, so no overflow utility is needed.
      */}
      <div className="flex flex-1 flex-wrap items-center gap-1 min-w-0">
        <div className="contents" role="tablist">
          {tabs.map((t) => {
            const isActive = t.matches(pathname)
            return (
              <Button key={t.href} asChild size="sm" variant={isActive ? 'default' : 'ghost'}>
                <Link href={t.href} prefetch={false} role="tab" aria-selected={isActive}>
                  <span>{t.name}</span>
                  <TabBadge kind={t.kind} project={project} active={isActive} />
                </Link>
              </Button>
            )
          })}
        </div>
        {/* Right-side controls grouped as one non-splittable unit; ml-auto
            pushes the group to the right edge of its flex line. */}
        <div className="ml-auto flex items-center gap-1">
          <ManageSharesDialog project={project} />
        </div>
      </div>
    </header>
  )
}
