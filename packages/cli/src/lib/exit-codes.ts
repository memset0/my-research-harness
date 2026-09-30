// Stable exit-code dictionary. Skills depend on these for branch logic.
export const EXIT = {
  SUCCESS: 0,
  GENERIC: 1,
  USAGE: 2,
  NOT_FOUND: 4,
  CONFLICT: 9,
  MEMON_TOO_OLD: 11,
  FORBIDDEN: 13,
} as const

export type ExitCode = (typeof EXIT)[keyof typeof EXIT]

export function exitCodeForErrorCode(
  code: 'BAD_REQUEST' | 'NOT_FOUND' | 'CONFLICT' | 'MEMON_TOO_OLD' | 'FORBIDDEN' | string,
): ExitCode {
  switch (code) {
    case 'BAD_REQUEST':
      return EXIT.USAGE
    case 'NOT_FOUND':
      return EXIT.NOT_FOUND
    case 'CONFLICT':
      return EXIT.CONFLICT
    case 'MEMON_TOO_OLD':
      return EXIT.MEMON_TOO_OLD
    case 'FORBIDDEN':
      return EXIT.FORBIDDEN
    default:
      return EXIT.GENERIC
  }
}

/**
 * Exit code for a Commander parse failure. Help and version output exit 0;
 * every other rejection (unknown option, missing argument, invalid choice,
 * missing subcommand) is a usage error, matching the BAD_REQUEST that the
 * invocation receipt records for it.
 */
export function commanderExitCode(commanderExit: number): ExitCode {
  return commanderExit === 0 ? EXIT.SUCCESS : EXIT.USAGE
}
