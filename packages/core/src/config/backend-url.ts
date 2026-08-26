import { BlockList, isIP } from 'node:net'

export const BACKEND_URL_POLICY_ERROR_CODES = [
  'INVALID_URL',
  'UNSUPPORTED_PROTOCOL',
  'USERINFO_NOT_ALLOWED',
  'QUERY_NOT_ALLOWED',
  'FRAGMENT_NOT_ALLOWED',
  'BASE_PATH_NOT_ALLOWED',
  'LINK_LOCAL_NOT_ALLOWED',
  'INSECURE_HTTP_NOT_ALLOWED',
  'INSECURE_HTTP_REQUIRES_IP_LITERAL',
  'INSECURE_HTTP_REQUIRES_PRIVATE_IP',
] as const

export type BackendUrlPolicyErrorCode = (typeof BACKEND_URL_POLICY_ERROR_CODES)[number]

export class BackendUrlPolicyError extends Error {
  constructor(
    public readonly code: BackendUrlPolicyErrorCode,
    message: string,
  ) {
    super(message)
    this.name = 'BackendUrlPolicyError'
  }
}

export interface BackendUrlPolicyOptions {
  allowInsecureHttp: boolean
}

const privateAddresses = new BlockList()
privateAddresses.addSubnet('10.0.0.0', 8, 'ipv4')
privateAddresses.addSubnet('172.16.0.0', 12, 'ipv4')
privateAddresses.addSubnet('192.168.0.0', 16, 'ipv4')
privateAddresses.addSubnet('127.0.0.0', 8, 'ipv4')
privateAddresses.addSubnet('fc00::', 7, 'ipv6')
privateAddresses.addAddress('::1', 'ipv6')

const linkLocalAddresses = new BlockList()
linkLocalAddresses.addSubnet('169.254.0.0', 16, 'ipv4')
linkLocalAddresses.addSubnet('fe80::', 10, 'ipv6')

function unbracketHostname(hostname: string): string {
  return hostname.startsWith('[') && hostname.endsWith(']') ? hostname.slice(1, -1) : hostname
}

function blockListContains(blockList: BlockList, hostname: string): boolean {
  const address = unbracketHostname(hostname)
  const family = isIP(address)
  if (family === 4) return blockList.check(address, 'ipv4')
  if (family === 6) return blockList.check(address, 'ipv6')
  return false
}

export function isLoopbackOrPrivateIpLiteral(hostname: string): boolean {
  return blockListContains(privateAddresses, hostname)
}

export function isLinkLocalIpLiteral(hostname: string): boolean {
  return blockListContains(linkLocalAddresses, hostname)
}

function policyError(code: BackendUrlPolicyErrorCode, message: string): never {
  throw new BackendUrlPolicyError(code, message)
}

function hasAsciiControl(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index)
    if (code <= 0x1f || code === 0x7f) return true
  }
  return false
}

/** Validate a configured Backend origin before it can carry a service token. */
export function normalizeBackendBaseUrl(rawUrl: string, options: BackendUrlPolicyOptions): string {
  if (
    typeof rawUrl !== 'string' ||
    rawUrl.length === 0 ||
    rawUrl !== rawUrl.trim() ||
    hasAsciiControl(rawUrl) ||
    rawUrl.includes('\\')
  ) {
    policyError('INVALID_URL', 'Backend base URL is malformed')
  }

  let url: URL
  try {
    url = new URL(rawUrl)
  } catch {
    policyError('INVALID_URL', 'Backend base URL is malformed')
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    policyError('UNSUPPORTED_PROTOCOL', 'Backend base URL must use http or https')
  }

  const schemeEnd = rawUrl.indexOf('://')
  if (schemeEnd === -1 || !/^https?:\/\//i.test(rawUrl)) {
    policyError('INVALID_URL', 'Backend base URL must use canonical origin syntax')
  }
  const afterScheme = rawUrl.slice(schemeEnd + 3)
  const authorityEnd = afterScheme.search(/[/?#]/)
  const rawAuthority = authorityEnd === -1 ? afterScheme : afterScheme.slice(0, authorityEnd)
  if (url.username || url.password || rawAuthority.includes('@')) {
    policyError('USERINFO_NOT_ALLOWED', 'Backend base URL must not contain userinfo')
  }
  if (rawUrl.includes('?')) {
    policyError('QUERY_NOT_ALLOWED', 'Backend base URL must not contain a query')
  }
  if (rawUrl.includes('#')) {
    policyError('FRAGMENT_NOT_ALLOWED', 'Backend base URL must not contain a fragment')
  }

  const rawPathStart = afterScheme.indexOf('/')
  const rawPath = rawPathStart === -1 ? '' : afterScheme.slice(rawPathStart)
  if ((rawPath !== '' && rawPath !== '/') || url.pathname !== '/') {
    policyError('BASE_PATH_NOT_ALLOWED', 'Backend base URL must be an origin with no base path')
  }
  if (isLinkLocalIpLiteral(url.hostname)) {
    policyError('LINK_LOCAL_NOT_ALLOWED', 'Backend base URL must not target link-local space')
  }

  if (url.protocol === 'http:') {
    if (!options.allowInsecureHttp) {
      policyError('INSECURE_HTTP_NOT_ALLOWED', 'Plain HTTP requires an explicit insecure opt-in')
    }
    const family = isIP(unbracketHostname(url.hostname))
    if (family === 0) {
      policyError(
        'INSECURE_HTTP_REQUIRES_IP_LITERAL',
        'Plain HTTP requires a loopback or private IP literal',
      )
    }
    if (!isLoopbackOrPrivateIpLiteral(url.hostname)) {
      policyError(
        'INSECURE_HTTP_REQUIRES_PRIVATE_IP',
        'Plain HTTP requires a loopback or private IP literal',
      )
    }
  }

  return url.origin
}
