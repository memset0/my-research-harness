'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { fetchLog } from '../lib/api'
import { Card, CardContent, CardHeader, CardTitle } from './ui'

const PAGE = 100

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

  const loadInitial = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const r = await fetchLog(logFile, { count: PAGE })
      setLines(r.lines)
      setTotalLines(r.totalLines)
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

  useEffect(() => {
    if (!follow || totalLines === null) return
    const t = setInterval(async () => {
      try {
        const r = await fetchLog(logFile, { count: PAGE })
        if (r.totalLines !== totalLines) {
          setLines(r.lines)
          setTotalLines(r.totalLines)
        }
      } catch {
        /* ignore — keep polling */
      }
    }, 3000)
    return () => clearInterval(t)
  }, [follow, totalLines, logFile])

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

  const containerRef = useRef<HTMLDivElement>(null)

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center gap-3">
          <CardTitle>Log: {logFile.replace(expPath + '/', '')}</CardTitle>
          <div className="ml-auto flex items-center gap-2 text-xs">
            <input
              type="text"
              value={logFile}
              onChange={(e) => setLogFile(e.target.value)}
              className="h-7 rounded border border-slate-300 px-2 font-mono text-xs"
              size={60}
            />
            <label className="flex items-center gap-1">
              <input type="checkbox" checked={follow} onChange={(e) => setFollow(e.target.checked)} />
              follow
            </label>
            {totalLines !== null && (
              <span className="text-slate-500">{totalLines.toLocaleString()} lines</span>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {error && <div className="mb-2 rounded bg-red-50 p-2 text-xs text-red-700">{error}</div>}
        <div className="flex justify-between mb-2 text-xs">
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
            {loading ? 'loading…' : 'jump to tail'}
          </button>
        </div>
        <div
          ref={containerRef}
          className="max-h-[60vh] overflow-auto rounded border border-slate-200 bg-slate-950 p-2 font-mono text-xs leading-tight text-slate-100"
        >
          {lines.length === 0 && !loading && (
            <div className="p-2 text-slate-500">no lines (file empty or missing)</div>
          )}
          {lines.map((l) => (
            <div key={l.lineNumber} className="grid grid-cols-[6ch_1fr] gap-2">
              <span className="text-right text-slate-500 select-none">{l.lineNumber}</span>
              <span className="break-all whitespace-pre-wrap">{l.text}</span>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  )
}
