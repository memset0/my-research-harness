// Stable exit-code dictionary. Skills depend on these for branch logic.
export const EXIT = {
  SUCCESS: 0,
  GENERIC: 1,
  USAGE: 2,
  NOT_FOUND: 4,
  CONFLICT: 9,
  FORBIDDEN: 13,
} as const

export type ExitCode = (typeof EXIT)[keyof typeof EXIT]

export function exitCodeForErrorCode(
  code: 'BAD_REQUEST' | 'NOT_FOUND' | 'CONFLICT' | 'FORBIDDEN' | string,
): ExitCode {
  switch (code) {
    case 'BAD_REQUEST':
      return EXIT.USAGE
    case 'NOT_FOUND':
      return EXIT.NOT_FOUND
    case 'CONFLICT':
      return EXIT.CONFLICT
    case 'FORBIDDEN':
      return EXIT.FORBIDDEN
    default:
      return EXIT.GENERIC
  }
}
