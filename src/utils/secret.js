import { createHash, timingSafeEqual } from 'node:crypto';

const digest = value => createHash('sha256').update(value, 'utf8').digest();

/** Compare a provided secret without leaking matching prefixes or length through timing. */
export function secretEquals(provided, expected) {
  if (typeof provided !== 'string' || typeof expected !== 'string' || !expected) return false;
  return timingSafeEqual(digest(provided), digest(expected));
}
