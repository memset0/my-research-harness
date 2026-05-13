import type { Metadata } from 'next'
import { Toaster } from 'sonner'
import NextTopLoader from 'nextjs-toploader'
import './globals.css'
import { Providers } from '../components/providers'
import { SessionBootstrap, readSerializedSession } from '../components/session-bootstrap'
import { ViewerBanner } from '../components/viewer-banner'
import { Inter } from "next/font/google";
import { cn } from "@/lib/utils";

const inter = Inter({subsets:['latin'],variable:'--font-sans'});

export const metadata: Metadata = {
  title: { default: 'memon', template: '%s · memon' },
  description: 'Run monitoring & management',
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const session = await readSerializedSession()
  return (
    <html lang="en" className={cn("font-sans", inter.variable)}>
      <head>
        <SessionBootstrap session={session} />
      </head>
      <body className="bg-background text-foreground antialiased">
        <NextTopLoader height={2} showSpinner={false} shadow={false} crawlSpeed={200} speed={200} />
        <Providers session={session}>
          <ViewerBanner />
          <div className="min-h-screen">{children}</div>
          <Toaster richColors position="bottom-right" closeButton />
        </Providers>
      </body>
    </html>
  )
}
