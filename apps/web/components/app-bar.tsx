'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { SidebarTrigger } from './ui/sidebar'
import { Separator } from './ui/separator'
import { NewExperimentButton } from './new-experiment-button'
import { cn } from '../lib/utils'

export function AppBar({ project }: { project: string }) {
  const pathname = usePathname() ?? ''
  const tabs = [
    { name: 'Experiments', href: `/p/${encodeURIComponent(project)}` },
    { name: 'Hypotheses', href: `/p/${encodeURIComponent(project)}/hypotheses` },
    { name: 'Journal', href: `/p/${encodeURIComponent(project)}/journal` },
  ]

  return (
    <header className="sticky top-0 z-20 flex h-12 shrink-0 items-center gap-3 border-b bg-background px-3 md:px-4">
      <SidebarTrigger className="md:hidden" />
      <Separator orientation="vertical" className="hidden h-5 md:block" />
      <nav className="flex items-center gap-1 overflow-x-auto" role="tablist">
        {tabs.map((t) => {
          const isActive = pathname === t.href
          return (
            <Link
              key={t.href}
              href={t.href}
              role="tab"
              aria-selected={isActive}
              className={cn(
                'rounded-md px-3 py-1.5 text-sm font-medium transition',
                isActive
                  ? 'bg-foreground text-background'
                  : 'text-foreground/70 hover:bg-accent hover:text-accent-foreground',
              )}
            >
              {t.name}
            </Link>
          )
        })}
      </nav>
      <div className="ml-auto flex items-center gap-2">
        <NewExperimentButton project={project} />
      </div>
    </header>
  )
}
