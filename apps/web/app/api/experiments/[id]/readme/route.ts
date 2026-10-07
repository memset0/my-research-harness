import type { NextRequest } from 'next/server'
import {
  readStandaloneReadme,
  writeStandaloneReadme,
} from '../../../../../lib/server/standalone-readme-route'
import { withStandaloneRequest } from '../../../../../lib/server/standalone-request'

export const dynamic = 'force-dynamic'

const scopedGET = (request: NextRequest, context: { params: Promise<{ id: string }> }) =>
  readStandaloneReadme('experiment', request, context)

const scopedPUT = (request: NextRequest, context: { params: Promise<{ id: string }> }) =>
  writeStandaloneReadme('experiment', request, context)

export const GET = withStandaloneRequest(scopedGET)
export const PUT = withStandaloneRequest(scopedPUT)
