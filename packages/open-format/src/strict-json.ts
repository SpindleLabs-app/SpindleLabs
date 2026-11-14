// Strict UTF-8 decoding and a strict JSON parser (RFC 8259) that refuses what
// JSON.parse lets through: duplicate keys (JSON.parse keeps the last one,
// silently), nesting deeper than 256 and numbers that overflow a double.

import { FormatError } from './errors.ts';

export const MAX_NESTING = 256;

/** Decodes UTF-8, refusing invalid sequences and a byte order mark. */
export function decodeUtf8Strict(bytes: Uint8Array, what: string): string {
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    throw new FormatError('bom', `${what} starts with a byte order mark`);
  }
  try {
    return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch {
    throw new FormatError('invalid-utf8', `${what} is not valid UTF-8`);
  }
}

/** Parses JSON text strictly. `what` names the text in error messages. */
export function parseStrictJson(text: string, what: string, maxDepth: number = MAX_NESTING): unknown {
  let i = 0;
  const fail = (message: string): never => {
    throw new FormatError('bad-json', `${what}: ${message} at character ${i}`);
  };
  const skipSpace = (): void => {
    while (i < text.length) {
      const c = text.charCodeAt(i);
      if (c === 0x20 || c === 0x09 || c === 0x0a || c === 0x0d) i++;
      else break;
    }
  };
  const parseString = (): string => {
    // text[i] is the opening quote
    i++;
    let out = '';
    let start = i;
    while (true) {
      if (i >= text.length) fail('unterminated string');
      const c = text.charCodeAt(i);
      if (c === 0x22) {
        out += text.slice(start, i);
        i++;
        return out;
      }
      if (c < 0x20) fail('control character in string');
      if (c === 0x5c) {
        out += text.slice(start, i);
        i++;
        const e = text[i];
        i++;
        switch (e) {
          case '"': out += '"'; break;
          case '\\': out += '\\'; break;
          case '/': out += '/'; break;
          case 'b': out += '\b'; break;
          case 'f': out += '\f'; break;
          case 'n': out += '\n'; break;
          case 'r': out += '\r'; break;
          case 't': out += '\t'; break;
          case 'u': {
            const hex = text.slice(i, i + 4);
            if (!/^[0-9A-Fa-f]{4}$/.test(hex)) fail('bad \\u escape');
            out += String.fromCharCode(parseInt(hex, 16));
            i += 4;
            break;
          }
          default:
            i--;
            fail('bad escape');
        }
        start = i;
      } else {
        i++;
      }
    }
  };
  const NUMBER = /-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/y;
  const parseNumber = (): number => {
    NUMBER.lastIndex = i;
    const m = NUMBER.exec(text);
    if (!m || m[0].length === 0 || m[0] === '-') fail('bad number');
    const lexeme = (m as RegExpExecArray)[0];
    const value = Number(lexeme);
    if (!Number.isFinite(value)) {
      throw new FormatError('number-out-of-range', `${what}: number ${lexeme.slice(0, 40)} is not a finite double`);
    }
    i += lexeme.length;
    return value;
  };
  const literal = (word: string, value: unknown): unknown => {
    if (text.startsWith(word, i)) {
      i += word.length;
      return value;
    }
    return fail('unexpected character');
  };
  const parseValue = (depth: number): unknown => {
    skipSpace();
    if (i >= text.length) fail('unexpected end');
    const c = text[i];
    if (c === '{' || c === '[') {
      if (depth + 1 > maxDepth) {
        throw new FormatError('too-deep', `${what}: nesting deeper than ${maxDepth}`);
      }
    }
    if (c === '{') {
      i++;
      const obj: Record<string, unknown> = {};
      const seen = new Set<string>();
      skipSpace();
      if (text[i] === '}') {
        i++;
        return obj;
      }
      while (true) {
        skipSpace();
        if (text[i] !== '"') fail('expected a key');
        const key = parseString();
        if (seen.has(key)) {
          throw new FormatError('duplicate-key', `${what}: duplicate key ${JSON.stringify(key.slice(0, 60))}`);
        }
        seen.add(key);
        skipSpace();
        if (text[i] !== ':') fail('expected ":"');
        i++;
        const value = parseValue(depth + 1);
        // defineProperty, so a key "__proto__" is an ordinary key, never the prototype
        Object.defineProperty(obj, key, { value, enumerable: true, writable: true, configurable: true });
        skipSpace();
        if (text[i] === ',') {
          i++;
          continue;
        }
        if (text[i] === '}') {
          i++;
          return obj;
        }
        fail('expected "," or "}"');
      }
    }
    if (c === '[') {
      i++;
      const arr: unknown[] = [];
      skipSpace();
      if (text[i] === ']') {
        i++;
        return arr;
      }
      while (true) {
        arr.push(parseValue(depth + 1));
        skipSpace();
        if (text[i] === ',') {
          i++;
          continue;
        }
        if (text[i] === ']') {
          i++;
          return arr;
        }
        fail('expected "," or "]"');
      }
    }
    if (c === '"') return parseString();
    if (c === 't') return literal('true', true);
    if (c === 'f') return literal('false', false);
    if (c === 'n') return literal('null', null);
    if (c === '-' || (c !== undefined && c >= '0' && c <= '9')) return parseNumber();
    return fail('unexpected character');
  };
  const value = parseValue(0);
  skipSpace();
  if (i !== text.length) fail('text after the value');
  return value;
}

/** Decodes and parses bytes as strict JSON. */
export function parseStrictJsonBytes(bytes: Uint8Array, what: string): unknown {
  return parseStrictJson(decodeUtf8Strict(bytes, what), what);
}
