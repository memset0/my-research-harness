const ABSOLUTE_POSIX_PATH = /(?:^|[\s"'=])\/(?:[^\s"']+\/)*[^\s"']*/g
const ABSOLUTE_WINDOWS_PATH = /\b[A-Za-z]:\\(?:[^\s"']+\\)*[^\s"']*/g
const AUTH_CHALLENGE = /\b(?:Bearer|Basic)\s+[A-Za-z0-9+/_=.-]+/gi

/** Bounded text safe for browser status payloads and log-facing serializers. */
export function redactOperationalText(
  input: unknown,
  secrets: readonly string[] = [],
  maxLength = 512,
): string {
  let text = input instanceof Error ? input.message : String(input ?? '')
  text = text.replace(/[\r\n\t]+/g, ' ')
  for (const secret of secrets) {
    if (secret) text = text.replaceAll(secret, '[REDACTED]')
  }
  text = text
    .replace(AUTH_CHALLENGE, '[AUTH_REDACTED]')
    .replace(ABSOLUTE_WINDOWS_PATH, '[PATH_REDACTED]')
    .replace(
      ABSOLUTE_POSIX_PATH,
      (match) => `${match[0]?.match(/[\s"'=]/) ? match[0] : ''}[PATH_REDACTED]`,
    )
    .trim()
  return (text || 'Operational failure').slice(0, maxLength)
}

export function safeLogRecord(
  level: 'info' | 'warn' | 'error',
  message: unknown,
  secrets: readonly string[] = [],
): Readonly<{ level: string; message: string }> {
  return Object.freeze({ level, message: redactOperationalText(message, secrets) })
}
