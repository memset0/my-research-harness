import Link from 'next/link'
import { Button } from '../components/ui'

export default function NotFound() {
  return (
    <main className="mx-auto max-w-2xl p-8">
      <h1 className="text-xl font-semibold">Page not found</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        We couldn't find what you were looking for. The project or experiment id might be wrong, or
        the resource may have been removed.
      </p>
      <div className="mt-4">
        <Button asChild>
          <Link href="/">Back to home</Link>
        </Button>
      </div>
    </main>
  )
}
