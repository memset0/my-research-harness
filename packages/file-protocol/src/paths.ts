import * as native from 'node:path'
export const { sep, delimiter, posix, win32, parse, format, toNamespacedPath } = native

/** Logical file authorities are never mount paths or subprocess working directories. */
export const FILE_URI_PREFIX = 'memon-file:'
export function isFileURI(value: string): boolean {
  return value.startsWith(`${FILE_URI_PREFIX}/`)
}
export function fileProjectURI(connection: string, project: string): string {
  for (const id of [connection, project]) {
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(id) || id === '.' || id === '..')
      throw new Error('invalid file authority identity')
  }
  return `${FILE_URI_PREFIX}/${connection}/${project}`
}
export function parseFileURI(value: string): {
  connection: string
  project: string
  path: string
  root: string
} {
  if (!isFileURI(value)) throw new Error('not a file authority URI')
  const parts = value.slice(FILE_URI_PREFIX.length + 1).split('/')
  const connection = parts.shift() ?? ''
  const project = parts.shift() ?? ''
  const root = fileProjectURI(connection, project)
  if (parts.some((part) => !part || part === '.' || part === '..' || part.includes('\\')))
    throw new Error('invalid file authority path')
  return { connection, project, path: parts.join('/'), root }
}
function logicalPath(value: string): string {
  return value.slice(FILE_URI_PREFIX.length)
}
export function join(...paths: string[]): string {
  if (!paths.some(isFileURI)) return native.join(...paths)
  if (!isFileURI(paths[0] ?? '') || paths.slice(1).some(isFileURI))
    throw new Error('cannot join different file authorities')
  return FILE_URI_PREFIX + native.posix.join(logicalPath(paths[0]!), ...paths.slice(1))
}
export function resolve(...paths: string[]): string {
  let anchor = -1
  for (let i = paths.length - 1; i >= 0; i--) {
    if (isFileURI(paths[i]!)) {
      anchor = i
      break
    }
    if (native.isAbsolute(paths[i]!)) return native.resolve(...paths)
  }
  if (anchor < 0) return native.resolve(...paths)
  return (
    FILE_URI_PREFIX + native.posix.resolve(logicalPath(paths[anchor]!), ...paths.slice(anchor + 1))
  )
}
export function normalize(value: string): string {
  return isFileURI(value)
    ? FILE_URI_PREFIX + native.posix.normalize(logicalPath(value))
    : native.normalize(value)
}
export function dirname(value: string): string {
  return isFileURI(value)
    ? FILE_URI_PREFIX + native.posix.dirname(logicalPath(value))
    : native.dirname(value)
}
export function basename(value: string, suffix?: string): string {
  return native.basename(isFileURI(value) ? logicalPath(value) : value, suffix)
}
export function extname(value: string): string {
  return native.extname(isFileURI(value) ? logicalPath(value) : value)
}
export function isAbsolute(value: string): boolean {
  return isFileURI(value) || native.isAbsolute(value)
}
export function relative(from: string, to: string): string {
  if (!isFileURI(from) && !isFileURI(to)) return native.relative(from, to)
  if (!isFileURI(from) || !isFileURI(to)) return `../${to}`
  const a = parseFileURI(from)
  const b = parseFileURI(to)
  if (a.root !== b.root) return `../${to}`
  return native.posix.relative(logicalPath(from), logicalPath(to))
}
export default {
  ...native,
  join,
  resolve,
  normalize,
  dirname,
  basename,
  extname,
  isAbsolute,
  relative,
}
