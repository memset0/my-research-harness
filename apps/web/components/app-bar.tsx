'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Button } from './ui/button'
import { SidebarTrigger } from './ui/sidebar'
import { Separator } from './ui/separator'
import { NewExperimentButton } from './new-experiment-button'

export function AppBar({ project }: { project: string }) {
  const pathname = usePathname() ?? ''
  const projectBase = `/p/${encodeURIComponent(project)}`
  const tabs: { name: string; href: string; matches: (p: string) => boolean }[] = [
    {
      name: 'Experiments',
      href: projectBase,
      // Active for the list view AND any experiment detail page
      matches: (p) => p === projectBase || p.startsWith(`${projectBase}/experiments`),
    },
    {
      name: 'Hypotheses',
      href: `${projectBase}/hypotheses`,
      matches: (p) => p.startsWith(`${projectBase}/hypotheses`),
    },
    {
      name: 'Journal',
      href: `${projectBase}/journal`,
      matches: (p) => p.startsWith(`${projectBase}/journal`),
    },
  ]

  return (
    <header className="sticky top-0 z-20 flex h-12 shrink-0 items-center gap-2 border-b bg-background px-3 md:px-4">
      <SidebarTrigger className="md:hidden" />
      <Separator orientation="vertical" className="hidden h-5 md:block" />
      <nav className="flex items-center gap-1 overflow-x-auto" role="tablist">
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
                {t.name}
              </Link>
            </Button>
          )
        })}
      </nav>
      <div className="ml-auto flex items-center gap-2">
        <NewExperimentButton project={project} />
      </div>
    </header>
  )
}
