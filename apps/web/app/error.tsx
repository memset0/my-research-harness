'use client'

import { useEffect } from 'react'
import { Button } from '../components/ui'

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    // eslint-disable-next-line no-console
    console.error('memon error:', error)
  }, [error])

  return (
    <main className="mx-auto max-w-2xl p-8">
      <h1 className="text-xl font-semibold">Something went wrong</h1>
      <p className="mt-2 text-sm text-slate-600">
        memon hit an unexpected error while rendering this page. The detail is in your browser
        console; below is the message:
      </p>
      <pre className="mt-3 max-h-60 overflow-auto rounded bg-slate-100 p-3 font-mono text-xs">
        {error.message}
        {error.digest ? `\n\ndigest: ${error.digest}` : ''}
      </pre>
      <div className="mt-4 flex gap-2">
        <Button onClick={() => reset()}>Try again</Button>
        <Button variant="outline" onClick={() => window.location.assign('/')}>
          Go home
        </Button>
      </div>
    </main>
  )
}
