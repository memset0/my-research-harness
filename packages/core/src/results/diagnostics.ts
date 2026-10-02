// Diagnostics of the FS v9 Results model, in the shared lint shape
// (`code`, `severity`, `file`, optional `field`) plus an optional 1-based
// `line` for result files.

export interface ResultsDiagnostic {
  code: string
  severity: 'error' | 'warning' | 'info'
  /** Project-relative file (or the bare file name when the location is unknown). */
  file: string
  field?: string
  /** 1-based line number inside `file`. */
  line?: number
  message: string
}

export function resultsDiagnostic(
  code: string,
  severity: ResultsDiagnostic['severity'],
  file: string,
  message: string,
  extra: { field?: string; line?: number } = {},
): ResultsDiagnostic {
  return {
    code,
    severity,
    file,
    ...(extra.field === undefined ? {} : { field: extra.field }),
    ...(extra.line === undefined ? {} : { line: extra.line }),
    message,
  }
}

export function hasErrorDiagnostic(diagnostics: readonly ResultsDiagnostic[]): boolean {
  return diagnostics.some((diagnostic) => diagnostic.severity === 'error')
}
