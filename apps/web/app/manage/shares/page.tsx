// /manage/shares — moved to the Shares card of Access control. The old URL
// keeps its capability (middleware also gates the path) and then redirects.

import { notFound, redirect } from 'next/navigation'
import { levelCan } from '../../../lib/server/auth/capabilities'
import { readAccountFromHeaders } from '../../../lib/server/auth/request-context'

export default async function SharesPage() {
  if (!levelCan((await readAccountFromHeaders())?.level, 'manage_project_grants')) notFound()
  redirect('/manage/access#shares')
}
