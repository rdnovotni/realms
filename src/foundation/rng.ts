import { createHmac } from 'node:crypto';
export function randomInteger(seed: Buffer, stream: string, counter: bigint, bound: number): number {
  if (seed.length !== 32 || !stream || counter < 0n || !Number.isSafeInteger(bound) || bound < 1 || bound > 0x100000000) throw new Error('Invalid RNG input');
  const limit = Math.floor(0x100000000 / bound) * bound;
  for (let attempt = 0; ; attempt++) {
    const bytes = createHmac('sha256', seed).update(JSON.stringify(['hmac-sha256-v1', stream, counter.toString(), attempt])).digest();
    const value = bytes.readUInt32BE(0);
    if (value < limit) return value % bound;
  }
}
