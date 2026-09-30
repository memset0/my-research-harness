'use client'

// Client wrapper around shadcn `SidebarProvider` that injects the
// persisted desktop sidebar width via the `style` prop.
//
// The shadcn primitive already spreads `style` AFTER its defaults
// (`--sidebar-width: 16rem`, `--sidebar-width-icon: 3rem`), so passing
// `style={{ '--sidebar-width': '${widthPx}px' }}` overrides the default
// without forking the primitive (CLAUDE.md F3).
//
// SSR uses DEFAULT_PX (= 16rem). The persisted value, if any, is read
// from localStorage in `useSidebarWidth` after mount and replaces the
// inline style on the wrapper. No hydration warning because inline CSS
// variable strings are not React-typed values.
//
// This wrapper is intentionally minimal and does NOT read the
// `sidebar_state` cookie itself — the caller (a server component layout)
// should read the cookie and pass `defaultOpen` through.

import * as React from 'react'
import { useSidebarWidth } from '../hooks/use-sidebar-width'
import { SidebarProvider } from './ui/sidebar'

type ResizableSidebarProviderProps = Omit<React.ComponentProps<typeof SidebarProvider>, 'style'> & {
  style?: React.CSSProperties
}

export function ResizableSidebarProvider({
  style,
  children,
  ...props
}: ResizableSidebarProviderProps) {
  const { widthPx } = useSidebarWidth()
  // Compose any caller-supplied style with our `--sidebar-width` override.
  // Cast to CSSProperties because TS doesn't know about custom CSS vars
  // by default; shadcn's primitive uses the same `as CSSProperties` cast.
  const mergedStyle = React.useMemo(
    () =>
      ({
        ...style,
        '--sidebar-width': `${widthPx}px`,
      }) as React.CSSProperties,
    [style, widthPx],
  )

  return (
    <SidebarProvider style={mergedStyle} {...props}>
      {children}
    </SidebarProvider>
  )
}
