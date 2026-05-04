// POST /api/terminal/install — fetch ttyd from upstream releases (no root).

import { NextResponse } from 'next/server'
import { TtydInstallError, installTtyd } from '../../../../lib/terminal/binary'

export const dynamic = 'force-dynamic'

const STATUS_BY_CODE: Readonly<Record<TtydInstallError['code'], number>> = {
  DOWNLOAD_FAILED: 502,
  INTEGRITY_FAILED: 502,
  NOT_AUTOFETCHABLE: 501,
  EXEC_FAILED: 500,
}

export async function POST() {
  try {
    const result = await installTtyd()
    return NextResponse.json(result)
  } catch (err) {
    if (err instanceof TtydInstallError) {
      return NextResponse.json(
        { ok: false, error: { code: err.code, message: err.message } },
        { status: STATUS_BY_CODE[err.code] },
      )
    }
    return NextResponse.json(
      { ok: false, error: { message: (err as Error).message } },
      { status: 500 },
    )
  }
}
