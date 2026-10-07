import type { NextRequest } from 'next/server'
import { withValidRunId } from '../../../../../lib/server/run-id'
import {
  readStandaloneReadme,
  writeStandaloneReadme,
} from '../../../../../lib/server/standalone-readme-route'
import { withStandaloneRequest } from '../../../../../lib/server/standalone-request'

export const dynamic = 'force-dynamic'

const scopedGET = withValidRunId(
  (request: NextRequest, context: { params: Promise<{ id: string }> }) =>
    readStandaloneReadme('run', request, context),
)

const scopedPUT = withValidRunId(
  (request: NextRequest, context: { params: Promise<{ id: string }> }) =>
    writeStandaloneReadme('run', request, context),
)

export const GET = withStandaloneRequest(scopedGET)
export const PUT = withStandaloneRequest(scopedPUT)
