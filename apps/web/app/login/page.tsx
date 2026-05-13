// /login — anon-accessible owner login form.
//
// Renders a shadcn Card with username/password inputs. On submit, the form
// POSTs to /api/auth/login (application/x-www-form-urlencoded). On success
// the server 302s to `?next` (or `/`). On failure the user lands back here
// with `?error=1` and the page re-renders with an inline error banner.

import { redirect } from 'next/navigation'
import { cookies } from 'next/headers'
import { getRuntime } from '@/lib/runtime'
import { SESSION_COOKIE_NAME, verifySessionCookie } from '@/lib/auth/cookies'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { AlertCircle } from 'lucide-react'

interface PageProps {
  searchParams: Promise<{ next?: string; error?: string }>
}

function validateNext(raw: string | undefined): string {
  if (!raw) return '/'
  // Same-origin only, never an /api/auth/* loop, never protocol-relative.
  if (!raw.startsWith('/')) return '/'
  if (raw.startsWith('//')) return '/'
  if (raw.startsWith('/api/auth/')) return '/'
  return raw
}

export const metadata = {
  title: 'Sign in',
}

export default async function LoginPage(props: PageProps) {
  const { next, error } = await props.searchParams
  const safeNext = validateNext(next)

  // If the user is already authenticated as owner, send them on.
  const runtime = await getRuntime()
  const cookieStore = await cookies()
  const sessionValue = cookieStore.get(SESSION_COOKIE_NAME)?.value ?? null
  if (sessionValue && runtime.auth.sessionSecret) {
    const ok = verifySessionCookie(sessionValue, runtime.auth.sessionSecret)
    if (ok) redirect(safeNext)
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>Sign in to memon</CardTitle>
          <CardDescription>
            Owner credentials live in <code className="text-xs">config.yml</code>.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form method="post" action="/api/auth/login" className="space-y-4">
            <input type="hidden" name="next" value={safeNext} />
            {error ? (
              <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
                <AlertCircle className="mt-0.5 size-4 shrink-0" />
                <span>Invalid credentials.</span>
              </div>
            ) : null}
            <div className="space-y-2">
              <Label htmlFor="username">Username</Label>
              <Input
                id="username"
                name="username"
                type="text"
                autoComplete="username"
                autoFocus
                defaultValue="admin"
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                name="password"
                type="password"
                autoComplete="current-password"
                required
              />
            </div>
            <Button type="submit" className="w-full">
              Sign in
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
