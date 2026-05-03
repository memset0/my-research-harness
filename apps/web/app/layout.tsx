import type { Metadata } from 'next'
import './globals.css'
import { Providers } from '../components/providers'

export const metadata: Metadata = {
  title: 'memon',
  description: 'Experiment monitoring & management',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="bg-slate-50 text-slate-900 antialiased">
        <Providers>
          <div className="min-h-screen">{children}</div>
        </Providers>
      </body>
    </html>
  )
}
