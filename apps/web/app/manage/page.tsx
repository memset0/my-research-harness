// /manage — the admin area entry: open the first section this account may use.

import { redirect } from 'next/navigation'
import { adminSectionsFor } from '../../lib/server/auth/capabilities'
import { readAccountFromHeaders } from '../../lib/server/auth/request-context'

export const metadata = { title: 'Admin — memon' }

export default async function ManageIndexPage() {
  const first = adminSectionsFor((await readAccountFromHeaders())?.level)[0]
  if (first) redirect(first.href)
  return (
    <p className="p-4 text-xs text-muted-foreground">
      No admin sections are available to your account yet.
    </p>
  )
}
