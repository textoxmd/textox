import { describe, expect, test } from 'vitest'
import { bytesToBase64 } from './binary'

describe('bytesToBase64', () => {
  test('round-trips small payloads', () => {
    const bytes = new Uint8Array([0, 1, 2, 253, 254, 255])
    expect(atob(bytesToBase64(bytes))).toBe('\u0000\u0001\u0002\u00fd\u00fe\u00ff')
  })

  test('handles payloads larger than one chunk', () => {
    const bytes = new Uint8Array(200_000)
    for (let i = 0; i < bytes.length; i++) bytes[i] = i % 256
    expect(bytesToBase64(bytes).length).toBe(Math.ceil(bytes.length / 3) * 4)
  })
})
