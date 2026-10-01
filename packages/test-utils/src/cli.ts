/** Thrown by the `spyExit` replacement of `process.exit`. */
export class ExitCalled extends Error {
  constructor(public exitCode: number) {
    super(`process.exit(${exitCode})`)
  }
}

/**
 * Replace `process.exit` with a function that records the code and throws
 * `ExitCalled`, so a command's exit path can be asserted. Call `restore()`.
 */
export function spyExit(): { restore: () => void; readonly code: number | null } {
  const real = process.exit
  let exitCode: number | null = null
  process.exit = ((code?: number) => {
    exitCode = code ?? 0
    throw new ExitCalled(exitCode)
  }) as typeof process.exit
  return {
    restore: () => {
      process.exit = real
    },
    get code() {
      return exitCode
    },
  }
}
