import { promises as fs } from 'node:fs'
import { isAbsolute, join, parse, relative, resolve, sep } from 'node:path'
import type { BackendStartGuards } from '@memon/core'

export const BACKEND_START_GUARD_ERROR_CODES = [
  'INVALID_HOSTNAME',
  'INVALID_HOST_PATTERN',
  'HOSTNAME_NOT_ALLOWED',
  'FORBIDDEN_ENVIRONMENT',
  'RUNTIME_DIR_NOT_ABSOLUTE',
  'INVALID_POLICY_ROOT',
  'RUNTIME_DIR_OVERLAPS_STATE',
  'RUNTIME_DIR_OVERLAPS_RELEASE',
  'RUNTIME_DIR_UNDER_SHARED_ROOT',
  'RUNTIME_DIR_SYMLINK',
  'RUNTIME_DIR_NOT_DIRECTORY',
  'RUNTIME_DIR_UNAVAILABLE',
] as const

export type BackendStartGuardErrorCode = (typeof BACKEND_START_GUARD_ERROR_CODES)[number]

export class BackendStartGuardError extends Error {
  constructor(
    public readonly code: BackendStartGuardErrorCode,
    message: string,
  ) {
    super(message)
    this.name = 'BackendStartGuardError'
  }
}

export type BackendStartGuardDecision =
  | { allowed: true }
  | { allowed: false; error: BackendStartGuardError }

export interface EvaluateBackendStartGuardsInput {
  guards: BackendStartGuards
  hostname: string
  environment: Readonly<Record<string, string | undefined>>
}

export interface RuntimeDirectoryPolicyOptions {
  stateDir: string
  releaseDir: string
  /** Project roots, shared homes, or other explicitly non-node-local roots. */
  forbiddenSharedRoots?: readonly string[]
}

export interface BackendStartPreflightInput extends EvaluateBackendStartGuardsInput {
  runtimeDir: string
  runtimePolicy: RuntimeDirectoryPolicyOptions
}

const HOSTNAME_PATTERN = /^[A-Za-z0-9.-]+$/
const HOSTNAME_GLOB_PATTERN = /^[A-Za-z0-9.*?-]+$/

function error(code: BackendStartGuardErrorCode, message: string): BackendStartGuardError {
  return new BackendStartGuardError(code, message)
}

/** Compile only `*` and `?`; every other accepted character is literal. */
function compileHostnameGlob(pattern: string): RegExp | null {
  if (pattern.length === 0 || !HOSTNAME_GLOB_PATTERN.test(pattern)) return null
  let source = '^'
  for (const character of pattern) {
    if (character === '*') source += '.*'
    else if (character === '?') source += '.'
    else if (character === '.') source += '\\.'
    else source += character
  }
  source += '$'
  return new RegExp(source, 'i')
}

/** Pure guard evaluation. It performs no filesystem or process operation. */
export function evaluateBackendStartGuards(
  input: EvaluateBackendStartGuardsInput,
): BackendStartGuardDecision {
  const hostname = input.hostname.endsWith('.') ? input.hostname.slice(0, -1) : input.hostname
  if (hostname.length === 0 || !HOSTNAME_PATTERN.test(hostname)) {
    return { allowed: false, error: error('INVALID_HOSTNAME', 'runtime hostname is invalid') }
  }

  if (input.guards.allowedHostnamePatterns.length > 0) {
    let matched = false
    for (const pattern of input.guards.allowedHostnamePatterns) {
      const matcher = compileHostnameGlob(pattern)
      if (!matcher) {
        return {
          allowed: false,
          error: error('INVALID_HOST_PATTERN', 'configured hostname guard pattern is invalid'),
        }
      }
      matched ||= matcher.test(hostname)
    }
    if (!matched) {
      return {
        allowed: false,
        error: error('HOSTNAME_NOT_ALLOWED', 'Backend start is not allowed on this hostname'),
      }
    }
  }

  for (const name of input.guards.forbiddenEnvironment) {
    // Presence is the guard: an explicitly empty value still identifies a job
    // or compute context and therefore must fail closed.
    if (Object.hasOwn(input.environment, name)) {
      return {
        allowed: false,
        error: error(
          'FORBIDDEN_ENVIRONMENT',
          `Backend start is forbidden while environment marker ${name} is present`,
        ),
      }
    }
  }
  return { allowed: true }
}

export function assertBackendStartGuards(input: EvaluateBackendStartGuardsInput): void {
  const decision = evaluateBackendStartGuards(input)
  if (!decision.allowed) throw decision.error
}

function isWithin(root: string, target: string): boolean {
  const rel = relative(root, target)
  return rel === '' || (!rel.startsWith(`..${sep}`) && rel !== '..' && !rel.startsWith(sep))
}

function pathsOverlap(a: string, b: string): boolean {
  return isWithin(a, b) || isWithin(b, a)
}

/** Pure lexical node-local runtime-directory policy. */
export function assertRuntimeDirectoryPolicy(
  runtimeDir: string,
  options: RuntimeDirectoryPolicyOptions,
): string {
  if (!isAbsolute(runtimeDir)) {
    throw error('RUNTIME_DIR_NOT_ABSOLUTE', 'Backend runtime directory must be absolute')
  }
  if (!isAbsolute(options.stateDir) || !isAbsolute(options.releaseDir)) {
    throw error('INVALID_POLICY_ROOT', 'Backend state and release policy roots must be absolute')
  }
  const normalizedRuntime = resolve(runtimeDir)
  const normalizedState = resolve(options.stateDir)
  const normalizedRelease = resolve(options.releaseDir)
  if (pathsOverlap(normalizedState, normalizedRuntime)) {
    throw error(
      'RUNTIME_DIR_OVERLAPS_STATE',
      'Backend runtime directory must be separate from persistent state',
    )
  }
  if (pathsOverlap(normalizedRelease, normalizedRuntime)) {
    throw error(
      'RUNTIME_DIR_OVERLAPS_RELEASE',
      'Backend runtime directory must be separate from immutable releases',
    )
  }

  for (const sharedRoot of options.forbiddenSharedRoots ?? []) {
    if (!isAbsolute(sharedRoot)) {
      throw error('INVALID_POLICY_ROOT', 'Forbidden shared roots must be absolute')
    }
    if (pathsOverlap(resolve(sharedRoot), normalizedRuntime)) {
      throw error('RUNTIME_DIR_UNDER_SHARED_ROOT', 'Backend runtime directory must be node-local')
    }
  }
  return normalizedRuntime
}

/**
 * Read-only filesystem preflight. Every existing path component is lstat'd;
 * symlinks and non-directories fail. A missing tail is allowed for a later,
 * separately authorized mkdir step, but this function never creates it.
 */
export async function preflightRuntimeDirectory(runtimeDir: string): Promise<void> {
  if (!isAbsolute(runtimeDir)) {
    throw error('RUNTIME_DIR_NOT_ABSOLUTE', 'Backend runtime directory must be absolute')
  }
  const normalized = resolve(runtimeDir)
  const root = parse(normalized).root
  const segments = relative(root, normalized).split(sep).filter(Boolean)
  let cursor = root
  for (const segment of segments) {
    cursor = join(cursor, segment)
    try {
      const stat = await fs.lstat(cursor)
      if (stat.isSymbolicLink()) {
        throw error('RUNTIME_DIR_SYMLINK', 'Backend runtime path must not traverse a symlink')
      }
      if (!stat.isDirectory()) {
        throw error(
          'RUNTIME_DIR_NOT_DIRECTORY',
          'Backend runtime path must contain directories only',
        )
      }
    } catch (caught) {
      if (caught instanceof BackendStartGuardError) throw caught
      if ((caught as NodeJS.ErrnoException).code === 'ENOENT') return
      throw error('RUNTIME_DIR_UNAVAILABLE', 'Backend runtime path cannot be inspected')
    }
  }
}

/** Complete guard preflight; callers may mkdir/lock/spawn only after it resolves. */
export async function preflightBackendStart(input: BackendStartPreflightInput): Promise<string> {
  assertBackendStartGuards(input)
  const runtimeDir = assertRuntimeDirectoryPolicy(input.runtimeDir, input.runtimePolicy)
  await preflightRuntimeDirectory(runtimeDir)
  return runtimeDir
}
