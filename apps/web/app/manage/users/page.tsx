// /manage/users — moved to the Users card of Access control. The old URL keeps
// its capability (middleware also gates the path) and then redirects.

import { notFound, redirect } from 'next/navigation'
import { levelCan } from '../../../lib/server/auth/capabilities'
import { readAccountFromHeaders } from '../../../lib/server/auth/request-context'

export default async function UsersPage() {
  if (!levelCan((await readAccountFromHeaders())?.level, 'manage_accounts')) notFound()
  redirect('/manage/access#users')
}
