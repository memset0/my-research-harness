'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { fetchLog } from '../lib/api'
import { Card, CardContent, CardHeader, CardTitle } from './ui'

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
            <input
              type="text"
              value={logFile}
              onChange={(e) => setLogFile(e.target.value)}
              className="h-7 rounded border border-slate-300 px-2 font-mono text-xs"
              size={60}
            />
            {totalLines !== null && (
              <span className="text-slate-500">{totalLines.toLocaleString()} lines</span>
            )}
            <span
              className={
                'rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase ' +
                (follow ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-200 text-slate-600')
              }
            >
              {follow ? 'follow' : 'paused'}
            </span>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {error && (
          <div className="mb-2 flex items-center justify-between rounded bg-red-50 p-2 text-xs text-red-700">
            <span>{error}</span>
            <button
              type="button"
              className="rounded border border-red-300 px-2 py-0.5 hover:bg-red-100"
              onClick={loadInitial}
            >
              retry
            </button>
          </div>
        )}
        <div className="mb-2 flex justify-between text-xs">
          <button
            type="button"
            disabled={lines.length === 0 || lines[0]!.lineNumber <= 1}
            onClick={onLoadEarlier}
            className="rounded border border-slate-200 px-2 py-1 text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            ↑ load 100 earlier
          </button>
          <button
            type="button"
            onClick={loadInitial}
            disabled={loading}
            className="rounded border border-slate-200 px-2 py-1 text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            {loading ? 'loading…' : 'reload'}
          </button>
        </div>
        <div className="relative">
          <div
            ref={containerRef}
            onScroll={onScroll}
            className="max-h-[60vh] overflow-auto rounded border border-slate-200 bg-slate-950 p-2 font-mono text-xs leading-tight text-slate-100"
          >
            {lines.length === 0 && !loading && (
              <div className="p-2 text-slate-500">no lines (file empty or missing)</div>
            )}
            {lines.map((l) => (
              <div key={l.lineNumber} className="grid grid-cols-[6ch_1fr] gap-2">
                <span className="select-none text-right text-slate-500">{l.lineNumber}</span>
                <span className="whitespace-pre-wrap break-all">{l.text}</span>
              </div>
            ))}
          </div>
          {pendingNew > 0 && !follow && (
            <button
              type="button"
              onClick={jumpToTail}
              className="absolute bottom-2 left-1/2 -translate-x-1/2 rounded-full border border-slate-200 bg-white px-3 py-1 text-xs text-slate-800 shadow-md hover:bg-slate-50"
            >
              {pendingNew} new line{pendingNew === 1 ? '' : 's'} ↓
            </button>
          )}
        </div>
      </CardContent>
    </Card>
  )
}
