'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { type ProjectTarget, projectRouteTarget } from '../lib/api'
import { type ProjectPage, parseProjectPath, projectPagePath } from '../lib/project-routes'
import { ManageSharesDialog } from './manage-shares-dialog'
import { useIsDocumentOnlyViewer } from './session-provider'
import { TabBadge, type TabKind } from './tab-badge'
import { Button } from './ui/button'
import { SidebarTrigger } from './ui/sidebar'

interface TabSpec {
  name: string
  kind: TabKind
  href: string
  /** The canonical page kinds (see project-routes) that make this tab active. */
  pages: readonly ProjectPage['kind'][]
}

export function AppBar({ project }: { project: ProjectTarget }) {
  const pathname = usePathname() ?? ''
  // A document-only share viewer has no Project navigation.
  const documentOnly = useIsDocumentOnlyViewer()
  const target = projectRouteTarget(project)
  const href = (page: ProjectPage) => projectPagePath(target, page)
  const tabs: TabSpec[] = [
    {
      name: 'Experiments',
      kind: 'experiments',
      href: href({ kind: 'overview' }),
      pages: ['overview', 'experiments', 'experiment'],
    },
    { name: 'Journal', kind: 'journal', href: href({ kind: 'journal' }), pages: ['journal'] },
    {
      name: 'Reports',
      kind: 'reports',
      href: href({ kind: 'reports' }),
      pages: ['reports', 'report'],
    },
    {
      name: 'Code Review',
      kind: 'code-review',
      href: href({ kind: 'code-reviews' }),
      pages: ['code-reviews', 'code-review'],
    },
    { name: 'Wiki', kind: 'wiki', href: href({ kind: 'wiki-list' }), pages: ['wiki-list', 'wiki'] },
  ]
  // Matching compares parsed path segments, so `/r/<n>` never matches
  // `/reports` and an Experiment review activates Code Review only.
  const parsed = parseProjectPath(pathname)
  const current =
    parsed && parsed.target.host === target.host && parsed.target.project === target.project
      ? parsed.page.kind
      : null

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
          {(documentOnly ? [] : tabs).map((t) => {
            const isActive = current !== null && t.pages.includes(current)
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
