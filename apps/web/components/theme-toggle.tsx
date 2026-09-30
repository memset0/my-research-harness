'use client'

import { Monitor, Moon, Sun } from 'lucide-react'
import { useTheme } from 'next-themes'
import * as React from 'react'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { cn } from '@/lib/utils'

const OPTIONS = [
  { value: 'light', label: 'Light', Icon: Sun },
  { value: 'dark', label: 'Dark', Icon: Moon },
  { value: 'system', label: 'System', Icon: Monitor },
] as const

type ThemeValue = (typeof OPTIONS)[number]['value']

// Width and height match the mounted toggle exactly so the sidebar header
// layout does not reflow when next-themes hydrates.
const PLACEHOLDER_CLASSES = 'h-8 w-[5.5rem]'

export function ThemeToggle({ className }: { className?: string }) {
  const { theme, setTheme } = useTheme()
  const [mounted, setMounted] = React.useState(false)
  React.useEffect(() => setMounted(true), [])

  if (!mounted) {
    return (
      <div
        data-theme-toggle
        data-mounted="false"
        className={cn(PLACEHOLDER_CLASSES, className)}
        aria-hidden
      />
    )
  }

  const currentValue: ThemeValue =
    theme === 'light' || theme === 'dark' || theme === 'system' ? theme : 'system'
  const index = OPTIONS.findIndex((o) => o.value === currentValue)

  return (
    <div
      data-theme-toggle
      data-mounted="true"
      className={cn('relative inline-flex h-8 items-center rounded-md bg-muted p-0.5', className)}
    >
      {/* Sliding indicator: a sibling that translates between slot positions.
          Keeping it outside ToggleGroup means the animation does not depend
          on per-item state classes — selection change just updates `index`. */}
      <div
        className="absolute top-0.5 left-0.5 h-7 w-7 rounded-sm bg-background shadow-sm transition-transform duration-200 ease-out"
        style={{ transform: `translateX(${index * 100}%)` }}
        aria-hidden
      />
      <ToggleGroup
        type="single"
        value={currentValue}
        onValueChange={(v: string) => {
          if (v) setTheme(v)
        }}
        spacing={0}
        className="relative z-10 gap-0 bg-transparent"
      >
        {OPTIONS.map(({ value, label, Icon }) => (
          <ToggleGroupItem
            key={value}
            value={value}
            aria-label={label}
            className={cn(
              'h-7 w-7 min-w-0 rounded-sm px-0',
              'hover:bg-transparent data-[state=on]:bg-transparent',
              currentValue === value ? 'text-foreground' : 'text-muted-foreground',
            )}
          >
            <Icon className="size-3.5" />
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
    </div>
  )
}
