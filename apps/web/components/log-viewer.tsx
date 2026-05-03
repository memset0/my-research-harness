'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { fetchLog } from '../lib/api'
import { Card, CardContent, CardHeader, CardTitle } from './ui'
import { Button } from './ui/button'
import { Input } from './ui/input'

const PAGE = 100
/** Distance in pixels from the bottom that still counts as "at the bottom". */
const BOTTOM_EPSILON_PX = 50

interface Line {
  lineNumber: number
  text: string
}

export function LogViewer({ expPath }: { expPath: string }) {
  const [logFile, setLogFile] = useState<string>(`${expPath}/logs/stdout.log`)
  const [lines, setLines] = useState<Line[]>([])
  const [totalLines, setTotalLines] = useState<number | null>(null)
  const [loading, setLoading] = useState(false)
  const [follow, setFollow] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [pendingNew, setPendingNew] = useState(0)

  const containerRef = useRef<HTMLDivElement>(null)
  const followRef = useRef(follow)
  followRef.current = follow

  // Initial load (and refetch when file path changes)
  const loadInitial = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const r = await fetchLog(logFile, { count: PAGE })
      setLines(r.lines)
      setTotalLines(r.totalLines)
      setPendingNew(0)
    } catch (e) {
      setError((e as Error).message)
      setLines([])
      setTotalLines(0)
    } finally {
      setLoading(false)
    }
  }, [logFile])

  useEffect(() => {
    void loadInitial()
  }, [loadInitial])

  // SSE follow stream
  useEffect(() => {
    if (typeof window === 'undefined') return
    const params = new URLSearchParams({ path: logFile })
    const es = new EventSource(`/api/log/stream?${params.toString()}`)

    es.addEventListener('ready', (e) => {
      try {
        const data = JSON.parse((e as MessageEvent).data) as { totalLines: number }
        setTotalLines(data.totalLines)
      } catch {
        /* ignore */
      }
    })

    es.addEventListener('append', (e) => {
      try {
        const data = JSON.parse((e as MessageEvent).data) as { lines: Line[] }
        if (!data.lines || data.lines.length === 0) return
        setLines((cur) => [...cur, ...data.lines])
        setTotalLines((t) => (t ?? 0) + data.lines.length)
        if (!followRef.current) {
          setPendingNew((n) => n + data.lines.length)
        }
      } catch {
        /* ignore */
      }
    })

    es.addEventListener('rotated', () => {
      void loadInitial()
    })

    es.addEventListener('error', () => {
      // EventSource auto-reconnects; surface a soft warning while connection
      // is in the reconnecting state.
      // (Browsers fire 'error' on transient drops; don't loudly toast.)
    })

    return () => {
      es.close()
    }
  }, [logFile, loadInitial])

  // Auto-scroll to bottom when new lines arrive in follow mode
  const linesLength = lines.length
  useEffect(() => {
    if (!follow) return
    const el = containerRef.current
    if (!el) return
    el.scrollTop = el.scrollHeight
  }, [linesLength, follow])

  // Scroll handling: detect at-bottom and toggle follow
  const onScroll = useCallback(() => {
    const el = containerRef.current
    if (!el) return
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight
    const atBottom = distanceFromBottom < BOTTOM_EPSILON_PX
    setFollow((cur) => {
      if (cur && !atBottom) return false
      if (!cur && atBottom) {
        setPendingNew(0)
        return true
      }
      return cur
    })
  }, [])

  const onLoadEarlier = useCallback(async () => {
    if (lines.length === 0) return
    const minLine = lines[0]!.lineNumber
    if (minLine <= 1) return
    const target = Math.max(1, minLine - 1)
    try {
      const r = await fetchLog(logFile, { endLine: target, count: PAGE })
      setLines((cur) => [...r.lines, ...cur])
    } catch (e) {
      setError((e as Error).message)
    }
  }, [lines, logFile])

  const jumpToTail = useCallback(() => {
    const el = containerRef.current
    if (!el) return
    el.scrollTop = el.scrollHeight
    setFollow(true)
    setPendingNew(0)
  }, [])

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center gap-3">
          <CardTitle>Log: {logFile.replace(`${expPath}/`, '')}</CardTitle>
          <div className="ml-auto flex items-center gap-2 text-xs">
            <Input
              type="text"
              value={logFile}
              onChange={(e) => setLogFile(e.target.value)}
              className="h-7 w-[28rem] font-mono text-xs"
            />
            {totalLines !== null && (
              <span className="text-muted-foreground">{totalLines.toLocaleString()} lines</span>
            )}
            <span
              className={
                'rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase ' +
                (follow
                  ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400'
                  : 'bg-muted text-muted-foreground')
              }
            >
              {follow ? 'follow' : 'paused'}
            </span>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {error && (
          <div className="mb-2 flex items-center justify-between rounded-md bg-destructive/10 p-2 text-xs text-destructive">
            <span>{error}</span>
            <Button size="sm" variant="outline" onClick={loadInitial}>
              retry
            </Button>
          </div>
        )}
        <div className="mb-2 flex justify-between text-xs">
          <Button
            size="sm"
            variant="outline"
            disabled={lines.length === 0 || lines[0]!.lineNumber <= 1}
            onClick={onLoadEarlier}
          >
            ↑ load 100 earlier
          </Button>
          <Button size="sm" variant="outline" onClick={loadInitial} disabled={loading}>
            {loading ? 'loading…' : 'reload'}
          </Button>
        </div>
        <div className="relative">
          <div
            ref={containerRef}
            onScroll={onScroll}
            className="max-h-[60vh] overflow-auto rounded-md border bg-zinc-950 p-2 font-mono text-xs leading-tight text-zinc-100"
          >
            {lines.length === 0 && !loading && (
              <div className="p-2 text-zinc-500">no lines (file empty or missing)</div>
            )}
            {lines.map((l) => (
              <div key={l.lineNumber} className="grid grid-cols-[6ch_1fr] gap-2">
                <span className="select-none text-right text-zinc-500">{l.lineNumber}</span>
                <span className="whitespace-pre-wrap break-all">{l.text}</span>
              </div>
            ))}
          </div>
          {pendingNew > 0 && !follow && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={jumpToTail}
              className="absolute bottom-2 left-1/2 -translate-x-1/2 rounded-full shadow-md"
            >
              {pendingNew} new line{pendingNew === 1 ? '' : 's'} ↓
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  )
}
