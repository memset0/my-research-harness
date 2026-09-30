'use client'

import { type ComponentType, useCallback, useEffect, useRef, useState } from 'react'

interface MonacoEditorProps {
  value?: string
  onChange?: (v: string | undefined) => void
  onMount?: (editor: unknown, monaco: unknown) => void
  options?: Record<string, unknown>
  defaultLanguage?: string
  height?: string | number
  width?: string | number
}

export interface ReadmeMonacoProps {
  value: string
  onChange: (next: string) => void
  /** Called once if Monaco's dynamic import or first mount errors. */
  onLoadError?: (err: unknown) => void
}

const MONACO_OPTIONS = {
  language: 'markdown',
  theme: 'vs',
  wordWrap: 'on',
  lineNumbers: 'on',
  lineNumbersMinChars: 3,
  minimap: { enabled: false },
  fontFamily:
    'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace',
  fontSize: 13,
  lineHeight: 20,
  automaticLayout: true,
  scrollBeyondLastLine: false,
  renderLineHighlight: 'none' as const,
  padding: { top: 12, bottom: 12 },
  smoothScrolling: true,
  cursorBlinking: 'smooth' as const,
  bracketPairColorization: { enabled: false },
  guides: { indentation: false },
  stickyScroll: { enabled: false },
}

/**
 * Read a CSS custom property and force-convert it through a canvas to a hex
 * string Monaco understands. oklch() / hsl() / rgb() all collapse to #rrggbb.
 */
function cssVarAsHex(name: string, fallback: string): string {
  if (typeof document === 'undefined') return fallback
  try {
    const raw = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
    if (!raw) return fallback
    const canvas = document.createElement('canvas')
    canvas.width = 1
    canvas.height = 1
    const ctx = canvas.getContext('2d')
    if (!ctx) return fallback
    ctx.fillStyle = raw
    ctx.fillRect(0, 0, 1, 1)
    const data = ctx.getImageData(0, 0, 1, 1).data
    const toHex = (n: number) => n.toString(16).padStart(2, '0')
    return `#${toHex(data[0] ?? 0)}${toHex(data[1] ?? 0)}${toHex(data[2] ?? 0)}`
  } catch {
    return fallback
  }
}

export function ReadmeMonaco({ value, onChange, onLoadError }: ReadmeMonacoProps) {
  const [Editor, setEditor] = useState<ComponentType<MonacoEditorProps> | null>(null)
  const [loadError, setLoadError] = useState(false)
  const erroredOnce = useRef(false)

  useEffect(() => {
    let cancelled = false
    import('@monaco-editor/react')
      .then((mod) => {
        if (cancelled) return
        setEditor(() => mod.default as ComponentType<MonacoEditorProps>)
      })
      .catch((err: unknown) => {
        if (cancelled) return
        setLoadError(true)
        if (!erroredOnce.current) {
          erroredOnce.current = true
          onLoadError?.(err)
        }
      })
    return () => {
      cancelled = true
    }
  }, [onLoadError])

  const handleMount = useCallback((_editor: unknown, monaco: unknown) => {
    try {
      // Pin the editor canvas to white so it reads as a clean writing
      // surface against the panel's bg-card grey, regardless of the rest of
      // the app's theme tokens.
      const bg = '#ffffff'
      const fg = cssVarAsHex('--foreground', '#0a0a0a')
      const muted = cssVarAsHex('--muted', '#f4f4f5')
      const gutterFg = cssVarAsHex('--muted-foreground', '#71717a')
      // biome-ignore lint/suspicious/noExplicitAny: Monaco's exported types are heavyweight.
      const m = monaco as any
      m.editor.defineTheme('memon-light', {
        base: 'vs',
        inherit: true,
        rules: [],
        colors: {
          'editor.background': bg,
          'editor.foreground': fg,
          'editorGutter.background': bg,
          'editorLineNumber.foreground': gutterFg,
          'editor.lineHighlightBackground': muted,
          'editor.lineHighlightBorder': muted,
          'editorIndentGuide.background1': muted,
        },
      })
      m.editor.setTheme('memon-light')
    } catch {
      // Theme registration is best-effort; fall back to vs default. Don't
      // promote this to a load failure.
    }
  }, [])

  if (loadError) {
    // Parent should have already swapped us out via onLoadError; render nothing.
    return null
  }

  if (!Editor) {
    return (
      <div
        data-testid="readme-monaco-loading"
        className="flex h-full items-center justify-center text-xs text-muted-foreground"
      >
        loading editor…
      </div>
    )
  }

  return (
    <Editor
      onMount={handleMount}
      value={value}
      onChange={(v) => onChange(v ?? '')}
      options={MONACO_OPTIONS}
      defaultLanguage="markdown"
      height="100%"
      width="100%"
    />
  )
}
