'use client'

import { Check, Copy } from 'lucide-react'
import { type ComponentPropsWithoutRef, useEffect, useRef, useState } from 'react'
import { cn } from '../lib/utils'
import { Button } from './ui/button'

/** Clipboard write with a hidden-textarea fallback for non-secure origins. */
async function writeClipboard(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text)
  } catch {
    const area = document.createElement('textarea')
    area.value = text
    area.style.position = 'fixed'
    area.style.opacity = '0'
    document.body.appendChild(area)
    area.select()
    document.execCommand('copy')
    area.remove()
  }
}

/** A fenced Markdown code block with a "Copy all" button for its plain text. */
export function CodeBlock({ className, children, ...rest }: ComponentPropsWithoutRef<'pre'>) {
  const preRef = useRef<HTMLPreElement | null>(null)
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    if (!copied) return
    const timer = window.setTimeout(() => setCopied(false), 1500)
    return () => window.clearTimeout(timer)
  }, [copied])
  return (
    <div className="group/code relative" data-code-block="">
      <pre ref={preRef} className={className} {...rest}>
        {children}
      </pre>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className={cn(
          'not-prose absolute top-1.5 right-1.5 h-6 gap-1 bg-background/90 px-1.5 text-xs',
          'opacity-0 transition-opacity group-hover/code:opacity-100 focus-visible:opacity-100',
          copied && 'opacity-100',
        )}
        aria-label={copied ? 'Copied' : 'Copy all'}
        onClick={async () => {
          await writeClipboard(preRef.current?.textContent ?? '')
          setCopied(true)
        }}
      >
        {copied ? (
          <Check className="size-3" aria-hidden />
        ) : (
          <Copy className="size-3" aria-hidden />
        )}
        {copied ? 'Copied' : 'Copy all'}
      </Button>
    </div>
  )
}
