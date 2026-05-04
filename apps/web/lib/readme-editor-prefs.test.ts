import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  clampWidth,
  readPlainPref,
  readWidthPref,
  writePlainPref,
  writeWidthPref,
} from './readme-editor-prefs'

beforeEach(() => {
  localStorage.clear()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('readme-editor-prefs', () => {
  it('readPlainPref defaults to false', () => {
    expect(readPlainPref()).toBe(false)
  })

  it('writePlainPref + readPlainPref round-trip', () => {
    writePlainPref(true)
    expect(readPlainPref()).toBe(true)
    writePlainPref(false)
    expect(readPlainPref()).toBe(false)
  })

  it('readWidthPref returns null when unset', () => {
    expect(readWidthPref()).toBeNull()
  })

  it('writeWidthPref + readWidthPref round-trip rounds to int', () => {
    writeWidthPref(640.7)
    expect(readWidthPref()).toBe(641)
  })

  it('readWidthPref returns null for non-numeric stored values', () => {
    localStorage.setItem('memon:readme-editor:width', 'banana')
    expect(readWidthPref()).toBeNull()
  })

  it('readPlainPref swallows storage errors', () => {
    const orig = Storage.prototype.getItem
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    expect(readPlainPref()).toBe(false)
    Storage.prototype.getItem = orig
  })

  it('writePlainPref swallows storage errors', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota')
    })
    expect(() => writePlainPref(true)).not.toThrow()
  })

  it('clampWidth respects min and 50% of viewport', () => {
    expect(clampWidth(100, 1280)).toBe(320) // below min
    expect(clampWidth(640, 1280)).toBe(640) // exact 50% of 1280
    expect(clampWidth(900, 1280)).toBe(640) // above 50%, clamps down
    expect(clampWidth(500, 1600)).toBe(500) // within bounds
    expect(clampWidth(900, 1600)).toBe(800) // 50% of 1600
  })
})
