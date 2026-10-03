'use client'

// The blocking Results error (web-dashboard "Results show a blocking error
// for inconsistent inputs"): the error code, every offending file with its
// recorded version or duplicate lines (or the description file diagnostics)
// and, for a schema mismatch, the exact upgrade command with a copy action.
// No Variant row, cell or partial table is ever rendered with it.

import { Check, Copy, FileWarning, TriangleAlert } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import type { ResultsSummaryErrorPayload } from '../../lib/dto/experiments'
import { Button } from '../ui/button'

export function ResultsErrorCard({ error }: { error: ResultsSummaryErrorPayload }) {
  const [copied, setCopied] = useState(false)
  const copy = async (command: string) => {
    try {
      await navigator.clipboard.writeText(command)
      setCopied(true)
      toast.success('Upgrade command copied')
    } catch {
      toast.error('Copy failed; select the command instead')
    }
  }
  return (
    <div
      role="alert"
      className="space-y-2.5 rounded-md border border-destructive/50 bg-destructive/5 p-3 text-xs"
      data-slot="results-error"
      data-error-code={error.code}
    >
      <div className="flex flex-wrap items-center gap-2">
        <TriangleAlert className="size-4 shrink-0 text-destructive" aria-hidden />
        <code className="rounded bg-destructive/10 px-1.5 py-0.5 font-mono text-[11px] font-semibold text-destructive">
          {error.code}
        </code>
        <span className="text-muted-foreground">
          The Results table is not shown until the inputs are consistent.
        </span>
      </div>
      <p className="break-words text-foreground/90">{error.message}</p>
      {error.files.length > 0 && (
        <ul className="space-y-1" data-slot="results-error-files">
          {error.files.map((file) => (
            <li key={file.file} className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
              <FileWarning
                className="size-3 shrink-0 self-center text-muted-foreground"
                aria-hidden
              />
              <code className="break-all font-mono text-[11px]">{file.file}</code>
              {file.version !== undefined && (
                <span className="text-muted-foreground" data-recorded-version>
                  records {file.version === null ? 'no version' : `version ${file.version}`}
                </span>
              )}
              {file.duplicates?.map((duplicate) => (
                <span
                  key={`${duplicate.key}:${duplicate.stat ?? ''}`}
                  className="text-muted-foreground"
                >
                  duplicate <code>{duplicate.key}</code>
                  {duplicate.stat ? <code>:{duplicate.stat}</code> : null} on lines{' '}
                  {duplicate.lines.join(', ')}
                </span>
              ))}
              {file.reason && <span className="text-muted-foreground">({file.reason})</span>}
            </li>
          ))}
        </ul>
      )}
      {error.upgradeCommand && (
        <div className="flex flex-wrap items-center gap-2">
          <code
            className="min-w-0 max-w-full overflow-x-auto rounded bg-muted px-2 py-1 font-mono text-[11px]"
            data-slot="results-upgrade-command"
          >
            {error.upgradeCommand}
          </code>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => void copy(error.upgradeCommand!)}
            aria-label="Copy the upgrade command"
          >
            {copied ? <Check data-icon="inline-start" /> : <Copy data-icon="inline-start" />}
            {copied ? 'Copied' : 'Copy'}
          </Button>
        </div>
      )}
      {error.diagnostics && error.diagnostics.length > 0 && (
        <ul className="list-disc space-y-0.5 pl-5 text-muted-foreground">
          {error.diagnostics.map((diagnostic) => (
            <li key={`${diagnostic.code}:${diagnostic.field ?? ''}:${diagnostic.message}`}>
              <code>{diagnostic.code}</code>
              {diagnostic.line ? ` (line ${diagnostic.line})` : ''}: {diagnostic.message}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
