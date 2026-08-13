import type { JsonValue } from '@deepseek-ai/dsh-session'

const STRING_CHUNK_CODE_UNITS = 8_192

type JsonTask =
  | { kind: 'value'; value: JsonValue; depth: number }
  | { kind: 'array'; iterator: ArrayIterator<JsonValue>; depth: number; first: boolean }
  | { kind: 'object'; iterator: ArrayIterator<[string, JsonValue]>; depth: number; first: boolean }

/** Yield one JSON string literal in bounded chunks with JSON.stringify-compatible escaping. */
function* jsonString(value: string): Generator<string> {
  yield '"'
  let chunk = ''
  const flush = function* (): Generator<string> {
    if (chunk.length === 0) return
    yield chunk
    chunk = ''
  }
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index)
    let encoded: string
    switch (code) {
      case 0x08: encoded = '\\b'; break
      case 0x09: encoded = '\\t'; break
      case 0x0A: encoded = '\\n'; break
      case 0x0C: encoded = '\\f'; break
      case 0x0D: encoded = '\\r'; break
      case 0x22: encoded = '\\"'; break
      case 0x5C: encoded = '\\\\'; break
      default: {
        if (code < 0x20 || (code >= 0xD800 && code <= 0xDFFF)) {
          const next = value.charCodeAt(index + 1)
          if (code >= 0xD800 && code <= 0xDBFF && next >= 0xDC00 && next <= 0xDFFF) {
            encoded = value.slice(index, index + 2)
            index++
          } else {
            encoded = `\\u${code.toString(16).padStart(4, '0')}`
          }
        } else {
          encoded = String.fromCharCode(code)
        }
      }
    }
    chunk += encoded
    if (chunk.length >= STRING_CHUNK_CODE_UNITS) yield* flush()
  }
  yield* flush()
  yield '"'
}

/** Yield one pretty-print newline and indentation in bounded chunks. */
function* indentation(indent: string, depth: number): Generator<string> {
  yield '\n'
  const maxIndentDepths = Math.max(1, Math.floor(STRING_CHUNK_CODE_UNITS / indent.length))
  let remaining = depth
  while (remaining > 0) {
    const count = Math.min(remaining, maxIndentDepths)
    yield indent.repeat(count)
    remaining -= count
  }
}

/**
 * Serialize one validated JSON value without recursion or a whole-result string.
 * @param value - frozen canonical JSON to serialize.
 * @param space - indentation width from 0 through 10.
 * @returns ordered chunks whose concatenation matches `JSON.stringify`.
 */
export function* streamJson(value: JsonValue, space: number): Generator<string> {
  const indent = ' '.repeat(space)
  const pretty = indent.length > 0
  const stack: JsonTask[] = [{ kind: 'value', value, depth: 0 }]
  let task: JsonTask | undefined
  while ((task = stack.pop()) !== undefined) {
    switch (task.kind) {
      case 'value': {
        const item = task.value
        if (item === null || typeof item === 'boolean' || typeof item === 'number') {
          yield JSON.stringify(item)
        } else if (typeof item === 'string') {
          yield* jsonString(item)
        } else if (Array.isArray(item)) {
          yield '['
          stack.push({ kind: 'array', iterator: item.values(), depth: task.depth, first: true })
        } else {
          yield '{'
          stack.push({
            kind: 'object', iterator: Object.entries(item).values(), depth: task.depth, first: true,
          })
        }
        break
      }
      case 'array': {
        const item = task.iterator.next()
        if (item.done) {
          if (pretty && !task.first) yield* indentation(indent, task.depth)
          yield ']'
          break
        }
        if (!task.first) yield ','
        if (pretty) yield* indentation(indent, task.depth + 1)
        stack.push({ ...task, first: false })
        stack.push({ kind: 'value', value: item.value, depth: task.depth + 1 })
        break
      }
      case 'object': {
        const item = task.iterator.next()
        if (item.done) {
          if (pretty && !task.first) yield* indentation(indent, task.depth)
          yield '}'
          break
        }
        if (!task.first) yield ','
        if (pretty) yield* indentation(indent, task.depth + 1)
        yield* jsonString(item.value[0])
        yield pretty ? ': ' : ':'
        stack.push({ ...task, first: false })
        stack.push({ kind: 'value', value: item.value[1], depth: task.depth + 1 })
        break
      }
    }
  }
}
