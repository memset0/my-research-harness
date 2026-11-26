'use client'

import { ChevronsUpDown, LogOut, Shield } from 'lucide-react'
import Link from 'next/link'
import { useAccount } from './session-provider'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from './ui/dropdown-menu'
import { SidebarMenuButton, SidebarMenuItem } from './ui/sidebar'

const LEVEL_LABEL = {
  super_admin: 'Super admin',
  admin: 'Admin',
  user: 'User',
  guest: 'Guest',
} as const

/** Bottom-left account entry: who is signed in, the admin area and sign-out. */
export function SidebarAccount() {
  const account = useAccount()
  if (!account) return null
  return (
    <SidebarMenuItem data-slot="sidebar-account">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <SidebarMenuButton size="sm" className="data-[state=open]:bg-sidebar-accent">
            <span className="truncate font-medium">{account.username}</span>
            <span className="truncate text-muted-foreground">{LEVEL_LABEL[account.level]}</span>
            <ChevronsUpDown className="ml-auto size-3.5" />
          </SidebarMenuButton>
        </DropdownMenuTrigger>
        <DropdownMenuContent side="top" align="start" className="min-w-48">
          <DropdownMenuLabel className="text-xs">{account.username}</DropdownMenuLabel>
          <DropdownMenuSeparator />
          {account.adminArea && (
            <DropdownMenuItem asChild>
              <Link href="/manage">
                <Shield />
                Admin
              </Link>
            </DropdownMenuItem>
          )}
          <DropdownMenuItem asChild>
            <form method="post" action="/api/auth/logout" className="w-full">
              <button type="submit" className="flex w-full items-center gap-2">
                <LogOut />
                Sign out
              </button>
            </form>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </SidebarMenuItem>
  )
}
