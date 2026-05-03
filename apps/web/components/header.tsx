'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'
import { fetchProjects, type ProjectSummary } from '../lib/api'
import { cn } from '../lib/utils'

export function Header({ project }: { project?: string }) {
  const { data } = useQuery({
    queryKey: ['projects'],
    queryFn: fetchProjects,
    staleTime: 60_000,
  })
  const projects: ProjectSummary[] = data?.projects ?? []
  const current = project ?? projects[0]?.name

  return (
    <header className="sticky top-0 z-10 border-b border-slate-200 bg-white">
      <div className="flex flex-wrap items-center gap-3 px-4 py-3 md:gap-6 md:px-6">
        <Link href="/" className="font-mono text-base font-semibold tracking-tight">
          memon
        </Link>
        <nav className="flex items-center gap-1 overflow-x-auto">
          {projects.map((p) => (
            <Link
              key={p.name}
              href={`/p/${encodeURIComponent(p.name)}`}
              className={cn(
                'rounded-md px-3 py-1.5 text-sm transition',
                p.name === current
                  ? 'bg-slate-900 text-white'
                  : 'text-slate-700 hover:bg-slate-100',
              )}
            >
              {p.name}
            </Link>
          ))}
        </nav>
        {current && <ViewTabs project={current} />}
      </div>
    </header>
  )
}

function ViewTabs({ project }: { project: string }) {
  const pathname = usePathname() ?? ''
  const tabs = [
    { name: 'Experiments', href: `/p/${encodeURIComponent(project)}` },
    { name: 'Hypotheses', href: `/p/${encodeURIComponent(project)}/hypotheses` },
    { name: 'Journal', href: `/p/${encodeURIComponent(project)}/journal` },
  ]
  return (
    <nav className="ml-auto flex items-center gap-1 text-sm">
      {tabs.map((t) => (
        <Link
          key={t.href}
          href={t.href}
          className={cn(
            'rounded-md px-3 py-1.5 transition',
            pathname === t.href
              ? 'bg-slate-100 text-slate-900'
              : 'text-slate-600 hover:bg-slate-50',
          )}
        >
          {t.name}
        </Link>
      ))}
    </nav>
  )
}
