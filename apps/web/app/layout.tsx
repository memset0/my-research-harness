import type { Metadata } from 'next'
import NextTopLoader from 'nextjs-toploader'
import { Toaster } from 'sonner'
import './globals.css'
import { Inter } from 'next/font/google'
import { cn } from '@/lib/utils'
import { Providers } from '../components/providers'
import {
  RuntimeConfigBootstrap,
  readSerializedRuntimeConfig,
} from '../components/runtime-config-bootstrap'
import { readSerializedSession, SessionBootstrap } from '../components/session-bootstrap'
import { ThemeProvider } from '../components/theme-provider'
import { ViewerBanner } from '../components/viewer-banner'

const inter = Inter({ subsets: ['latin'], variable: '--font-sans' })

export const metadata: Metadata = {
  title: { default: 'memon', template: '%s · memon' },
  description: 'Run monitoring & management',
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const [session, runtimeConfig] = await Promise.all([
    readSerializedSession(),
    readSerializedRuntimeConfig(),
  ])
  return (
    <html lang="en" suppressHydrationWarning className={cn('font-sans', inter.variable)}>
      <head>
        <SessionBootstrap session={session} />
        <RuntimeConfigBootstrap config={runtimeConfig} />
      </head>
      <body className="bg-background text-foreground antialiased">
        <NextTopLoader height={2} showSpinner={false} shadow={false} crawlSpeed={200} speed={200} />
        <Providers session={session} runtimeConfig={runtimeConfig}>
          <ThemeProvider
            attribute="class"
            defaultTheme="system"
            enableSystem
            disableTransitionOnChange
          >
            <ViewerBanner />
            <div className="min-h-screen">{children}</div>
            <Toaster richColors position="bottom-right" closeButton />
          </ThemeProvider>
        </Providers>
      </body>
    </html>
  )
}
