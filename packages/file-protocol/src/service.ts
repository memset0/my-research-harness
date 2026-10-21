import type { RequestOptions } from 'node:https'
import type { AgentConnection } from './client.js'
import { FileAccessError } from './index.js'

/** Streaming service transport uses the same mTLS and source pin as file reads. */
export function fileAgentServiceRequest(
  connection: AgentConnection,
  project: string,
  port: number,
  path: string,
): { url: URL; options: RequestOptions; expectedSourceIdentity: string } {
  const endpoint = new URL(connection.endpoint)
  if (
    endpoint.protocol !== 'https:' ||
    endpoint.username ||
    endpoint.password ||
    endpoint.search ||
    endpoint.hash ||
    !['', '/'].includes(endpoint.pathname) ||
    !/^[A-Za-z0-9._-]+$/.test(project) ||
    !Number.isInteger(port) ||
    port < 1 ||
    port > 65535 ||
    !path.startsWith('/') ||
    path.startsWith('//')
  )
    throw new FileAccessError('BAD_REQUEST')
  return {
    url: new URL(`/v1/services/${encodeURIComponent(project)}/${port}${path}`, endpoint),
    options: {
      ca: connection.ca,
      cert: connection.certificate,
      key: connection.key,
      minVersion: 'TLSv1.3',
      rejectUnauthorized: true,
      headers: { 'x-memon-expected-source-identity': connection.expectedSourceIdentity },
    },
    expectedSourceIdentity: connection.expectedSourceIdentity,
  }
}
