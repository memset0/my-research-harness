/**
 * First-frame JPEG of a figure video, extracted on the serving machine so the
 * browser never has to touch the video before the reader presses play.
 *
 * Bounded on every axis: at most `MAX_CONCURRENT` ffmpeg processes (FIFO),
 * each killed after `TIMEOUT_MS`, and output beyond `MAX_BYTES` aborts the
 * extraction. No shell is involved; the path is a single argv element.
 */

import 'server-only'

import { spawn } from 'node:child_process'

const MAX_CONCURRENT = 2
const TIMEOUT_MS = 15_000
const MAX_BYTES = 5 * 1024 * 1024

let running = 0
const waiting: (() => void)[] = []

async function acquire(): Promise<void> {
  if (running < MAX_CONCURRENT) {
    running += 1
    return
  }
  await new Promise<void>((resolve) => waiting.push(resolve))
}

function release(): void {
  const next = waiting.shift()
  if (next) next()
  else running -= 1
}

/** JPEG bytes, or null when ffmpeg is missing, fails, times out, or produces nothing usable. */
export async function extractVideoThumbnail(
  ffmpeg: string,
  videoPath: string,
): Promise<Buffer | null> {
  await acquire()
  try {
    return await new Promise<Buffer | null>((resolve) => {
      const child = spawn(
        ffmpeg,
        [
          '-nostdin',
          '-hide_banner',
          '-loglevel',
          'error',
          '-i',
          videoPath,
          '-frames:v',
          '1',
          '-vf',
          "scale='min(960,iw)':-2",
          '-f',
          'image2pipe',
          '-c:v',
          'mjpeg',
          '-q:v',
          '4',
          'pipe:1',
        ],
        { stdio: ['ignore', 'pipe', 'ignore'] },
      )
      const chunks: Buffer[] = []
      let size = 0
      let settled = false
      const finish = (value: Buffer | null) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        resolve(value)
      }
      const timer = setTimeout(() => {
        child.kill('SIGKILL')
        finish(null)
      }, TIMEOUT_MS)
      child.stdout.on('data', (chunk: Buffer) => {
        size += chunk.length
        if (size > MAX_BYTES) {
          child.kill('SIGKILL')
          finish(null)
          return
        }
        chunks.push(chunk)
      })
      child.on('error', () => finish(null))
      child.on('close', (code) => finish(code === 0 && size > 0 ? Buffer.concat(chunks) : null))
    })
  } finally {
    release()
  }
}
