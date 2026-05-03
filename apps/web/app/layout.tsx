import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'memon',
  description: 'Experiment monitoring & management',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
