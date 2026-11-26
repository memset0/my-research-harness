'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  NavigationMenu,
  NavigationMenuItem,
  NavigationMenuLink,
  NavigationMenuList,
} from './ui/navigation-menu'

export interface AdminNavSection {
  key: string
  label: string
  href: string
}

/** Admin-area top navbar; the server passes only sections the account may open. */
export function AdminNav({ sections }: { sections: AdminNavSection[] }) {
  const pathname = usePathname()
  if (sections.length === 0) return null
  return (
    <NavigationMenu viewport={false} data-slot="admin-nav" className="justify-start">
      <NavigationMenuList className="gap-0.5">
        {sections.map((section) => {
          const active = pathname === section.href || pathname.startsWith(`${section.href}/`)
          return (
            <NavigationMenuItem key={section.key}>
              <NavigationMenuLink asChild active={active} className="px-2 py-1">
                <Link href={section.href} aria-current={active ? 'page' : undefined}>
                  {section.label}
                </Link>
              </NavigationMenuLink>
            </NavigationMenuItem>
          )
        })}
      </NavigationMenuList>
    </NavigationMenu>
  )
}
