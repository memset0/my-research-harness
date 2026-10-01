// RFC 4180 record parsing and field quoting shared by the git commit-marks
// CSV and the wiki review CSV.

/** Quote a field when it contains a comma, quote or line break. */
export function quoteCsvField(s: string): string {
  if (s === '') return ''
  if (s.includes(',') || s.includes('"') || s.includes('\n') || s.includes('\r')) {
    return `"${s.replace(/"/g, '""')}"`
  }
  return s
}

/** Split CSV text into records of fields; blank lines are skipped. */
export function parseCsvRecords(text: string): string[][] {
  const records: string[][] = []
  let row: string[] = []
  let field = ''
  let inQuotes = false
  let fieldStartedQuoted = false
  let i = 0
  while (i < text.length) {
    const ch = text[i]!
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"'
          i += 2
          continue
        }
        inQuotes = false
        i += 1
        continue
      }
      field += ch
      i += 1
      continue
    }
    if (ch === '"' && field === '' && !fieldStartedQuoted) {
      inQuotes = true
      fieldStartedQuoted = true
      i += 1
      continue
    }
    if (ch === ',') {
      row.push(field)
      field = ''
      fieldStartedQuoted = false
      i += 1
      continue
    }
    if (ch === '\n' || ch === '\r') {
      row.push(field)
      field = ''
      fieldStartedQuoted = false
      if (!(row.length === 1 && row[0] === '')) records.push(row)
      row = []
      i += ch === '\r' && text[i + 1] === '\n' ? 2 : 1
      continue
    }
    field += ch
    i += 1
  }
  if (field !== '' || row.length > 0) {
    row.push(field)
    records.push(row)
  }
  return records
}
