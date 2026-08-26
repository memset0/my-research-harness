import {
  BackendTerminalServiceError,
  BackendTtydInstallError,
  type LocalBackendTerminalService,
} from '@memon/backend'
import {
  BackendTerminalListResponseSchema,
  BackendTerminalSessionSchema,
  type Config,
} from '@memon/core'
import { NextResponse } from 'next/server'
import { standaloneServices } from './standalone-services'

export function standaloneTerminal(config: Config): LocalBackendTerminalService {
  return standaloneServices(config).terminal()
}

export function standaloneTerminalSession(service: LocalBackendTerminalService, value: unknown) {
  const session = BackendTerminalSessionSchema.parse(value)
  const target = service.target(session.sessionName)
  const port = target ? Number(new URL(target).port) : undefined
  return {
    ...(session.backend ? { backend: session.backend } : {}),
    sessionName: session.sessionName,
    url: `/api/terminal/proxy/${encodeURIComponent(session.sessionName)}/`,
    ...(port ? { port } : {}),
    startedAt: session.startedAt,
    lastActiveAt: session.lastActiveAt,
    agent: session.agent,
    project: session.project ?? '',
    scope: session.scope ?? 'project',
    slug: session.slug ?? 'root',
    warnings: session.warnings,
  }
}

export function standaloneTerminalList(service: LocalBackendTerminalService, value: unknown) {
  const list = BackendTerminalListResponseSchema.parse(value)
  return { sessions: list.sessions.map((session) => standaloneTerminalSession(service, session)) }
}

export function standaloneTerminalError(error: unknown): NextResponse {
  if (error instanceof BackendTtydInstallError) {
    const status =
      error.code === 'NOT_AUTOFETCHABLE'
        ? 501
        : error.code === 'DOWNLOAD_FAILED' || error.code === 'INTEGRITY_FAILED'
          ? 502
          : 500
    return NextResponse.json({ error: { code: error.code, message: error.message } }, { status })
  }
  if (error instanceof BackendTerminalServiceError) {
    const status =
      error.code === 'BAD_REQUEST'
        ? 400
        : error.code === 'PROJECT_NOT_FOUND'
          ? 404
          : error.code === 'CONFLICT'
            ? 409
            : 503
    return NextResponse.json({ error: { code: error.code, message: error.message } }, { status })
  }
  return NextResponse.json(
    { error: { code: 'INTERNAL', message: 'Terminal operation failed' } },
    { status: 500 },
  )
}
