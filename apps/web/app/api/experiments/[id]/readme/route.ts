import type { NextRequest } from 'next/server'
import {
  readStandaloneReadme,
  writeStandaloneReadme,
} from '../../../../../lib/server/standalone-readme-route'

export const dynamic = 'force-dynamic'

export const GET = (request: NextRequest, context: { params: Promise<{ id: string }> }) =>
  readStandaloneReadme('experiment', request, context)

export const PUT = (request: NextRequest, context: { params: Promise<{ id: string }> }) =>
  writeStandaloneReadme('experiment', request, context)
