import type { NextRequest } from 'next/server'
import { withValidRunId } from '../../../../../lib/server/run-id'
import {
  readStandaloneReadme,
  writeStandaloneReadme,
} from '../../../../../lib/server/standalone-readme-route'

export const dynamic = 'force-dynamic'

export const GET = withValidRunId(
  (request: NextRequest, context: { params: Promise<{ id: string }> }) =>
    readStandaloneReadme('run', request, context),
)

export const PUT = withValidRunId(
  (request: NextRequest, context: { params: Promise<{ id: string }> }) =>
    writeStandaloneReadme('run', request, context),
)
