import Link from 'next/link'

export default function NotFound() {
  return (
    <main className="mx-auto max-w-2xl p-8">
      <h1 className="text-xl font-semibold">Page not found</h1>
      <p className="mt-2 text-sm text-slate-600">
        We couldn't find what you were looking for. The project or experiment id might be wrong, or
        the resource may have been removed.
      </p>
      <div className="mt-4">
        <Link
          href="/"
          className="inline-flex items-center rounded-md bg-slate-900 px-4 py-2 text-sm text-white hover:bg-slate-800"
        >
          Back to home
        </Link>
      </div>
    </main>
  )
}
