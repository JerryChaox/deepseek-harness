import { describe, expect, it } from 'vitest'
import type { JsonValue } from '@deepseek-ai/dsh-session'
import { streamJson } from '../src/json-stream.ts'

function render(value: JsonValue, space: number): string {
  return [...streamJson(value, space)].join('')
}

describe('streamJson', () => {
  it.each([0, 1, 2, 10])('matches JSON.stringify at space=%i', (space) => {
    const value: JsonValue = {
      empty: {},
      emptyArray: [],
      emptyString: '',
      array: [null, true, false, -0, 1.25, 'quote" slash\\ controls\b\t\n\f\r\u0001'],
      unicode: '你好😀\u2028\u2029',
      loneSurrogates: '\uD800x\uDC00',
      nested: { alpha: [{ beta: 'value' }] },
    }
    expect(render(value, space)).toBe(JSON.stringify(value, null, space))
  })

  it('bounds individual chunks for a large string while preserving its bytes', () => {
    const value = `start-${'😀"\\\n'.repeat(20_000)}-end`
    const chunks = [...streamJson(value, 0)]
    expect(chunks.join('')).toBe(JSON.stringify(value))
    expect(Math.max(...chunks.map(chunk => Buffer.byteLength(chunk, 'utf8')))).toBeLessThan(40_000)
  })

  it('serializes a deeply nested value without recursive calls', () => {
    let value: JsonValue = 'leaf'
    for (let index = 0; index < 20_000; index++) value = [value]
    const chunks = [...streamJson(value, 0)]
    expect(chunks.slice(0, 20_000).join('')).toBe('['.repeat(20_000))
    expect(chunks.slice(-20_000).join('')).toBe(']'.repeat(20_000))
  })

  it('bounds indentation chunks for deep pretty-printed values', () => {
    let value: JsonValue = 'leaf'
    for (let index = 0; index < 2_000; index++) value = [value]
    const chunks = [...streamJson(value, 10)]
    expect(Math.max(...chunks.map(chunk => chunk.length))).toBeLessThanOrEqual(8_192)
  })
})
