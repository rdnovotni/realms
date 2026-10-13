import { createHash } from 'node:crypto';
export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export function canonicalJson(value: Json): string {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('Non-finite JSON number');
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(value[key]!)}`).join(',')}}`;
}
export const checksum = (value: Json) => createHash('sha256').update(canonicalJson(value)).digest('hex');
