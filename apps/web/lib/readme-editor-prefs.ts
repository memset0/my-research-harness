const PLAIN_KEY = 'memon:readme-editor:plain'
const WIDTH_KEY = 'memon:readme-editor:width'

export function readPlainPref(): boolean {
  try {
    return localStorage.getItem(PLAIN_KEY) === '1'
  } catch {
    return false
  }
}

export function writePlainPref(v: boolean): void {
  try {
    localStorage.setItem(PLAIN_KEY, v ? '1' : '0')
  } catch {
    /* ignore */
  }
}

export function readWidthPref(): number | null {
  try {
    const raw = localStorage.getItem(WIDTH_KEY)
    if (!raw) return null
    const n = Number(raw)
    return Number.isFinite(n) && n > 0 ? n : null
  } catch {
    return null
  }
}

export function writeWidthPref(px: number): void {
  try {
    localStorage.setItem(WIDTH_KEY, String(Math.round(px)))
  } catch {
    /* ignore */
  }
}

export function clampWidth(px: number, viewportWidth: number): number {
  const min = 320
  const max = Math.max(min, Math.floor(viewportWidth * 0.5))
  return Math.min(max, Math.max(min, px))
}
