import type { Metadata } from 'next'
import { Toaster } from 'sonner'
import './globals.css'
import { Providers } from '../components/providers'
import { Inter } from "next/font/google";
import { cn } from "@/lib/utils";

const inter = Inter({subsets:['latin'],variable:'--font-sans'});

export const metadata: Metadata = {
  title: 'memon',
  description: 'Experiment monitoring & management',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={cn("font-sans", inter.variable)}>
      <body className="bg-background text-foreground antialiased">
        <Providers>
          <div className="min-h-screen">{children}</div>
          <Toaster richColors position="bottom-right" closeButton />
        </Providers>
      </body>
    </html>
  )
}
