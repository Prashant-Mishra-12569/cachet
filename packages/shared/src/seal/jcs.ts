/**
 * JSON Canonicalization Scheme (RFC 8785): the same data always gives the same bytes, so
 * signatures and hashes over JSON are stable.
 *
 * Restricted to what seals use: objects, arrays, strings, booleans, null and SAFE INTEGERS.
 * Floats are rejected on purpose (money is carried as decimal strings).
 */
export function canonicalize(value: unknown): string {
  if (value === null) return 'null';
  switch (typeof value) {
    case 'boolean':
      return value ? 'true' : 'false';
    case 'string':
      return JSON.stringify(value);
    case 'number':
      if (!Number.isSafeInteger(value))
        throw new TypeError(`JCS: only safe integers are allowed, got ${value}`);
      return JSON.stringify(value);
    case 'object': {
      if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`;
      const proto = Object.getPrototypeOf(value) as unknown;
      if (proto !== Object.prototype && proto !== null)
        throw new TypeError('JCS: only plain objects are allowed');
      const entries = Object.entries(value as Record<string, unknown>).filter(([, v]) => v !== undefined);
      // RFC 8785 §3.2.3: sort by UTF-16 code units, which is exactly JavaScript's default string order.
      entries.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
      return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalize(v)}`).join(',')}}`;
    }
    default:
      throw new TypeError(`JCS: unsupported type ${typeof value}`);
  }
}
