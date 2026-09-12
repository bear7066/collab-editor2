import { describe, expect, test } from 'bun:test';
import {
  SESSION_TTL_MS,
  createSessionToken,
  needsRefresh,
  parseAllowedIds,
  parseCookies,
  sanitizeReturnTo,
  verifySessionToken,
} from './auth.js';

const SECRET = 'test-secret-that-is-at-least-32-characters-long';
const USER = { id: 86918643, login: 'bear7066' };
const NOW = Date.UTC(2026, 8, 12);

describe('session tokens', () => {
  test('round-trips a signed session', async () => {
    const token = await createSessionToken(USER, SECRET, NOW);
    const session = await verifySessionToken(token, SECRET, NOW + 1000);
    expect(session).toEqual({ user: USER, exp: NOW + SESSION_TTL_MS });
  });

  test('rejects a token whose payload was altered', async () => {
    const token = await createSessionToken(USER, SECRET, NOW);
    const [, signature] = token.split('.');
    const forgedPayload = Buffer.from(JSON.stringify({ id: 1, login: 'intruder', exp: NOW + SESSION_TTL_MS })).toString('base64url');
    expect(await verifySessionToken(`${forgedPayload}.${signature}`, SECRET, NOW)).toBeNull();
  });

  test('rejects a token signed with another secret', async () => {
    const token = await createSessionToken(USER, 'another-secret-that-is-also-long-enough!!', NOW);
    expect(await verifySessionToken(token, SECRET, NOW)).toBeNull();
  });

  test('rejects an expired token', async () => {
    const token = await createSessionToken(USER, SECRET, NOW);
    expect(await verifySessionToken(token, SECRET, NOW + SESSION_TTL_MS + 1)).toBeNull();
  });

  test('rejects malformed tokens', async () => {
    expect(await verifySessionToken('', SECRET, NOW)).toBeNull();
    expect(await verifySessionToken('not-a-token', SECRET, NOW)).toBeNull();
    expect(await verifySessionToken('a.b.c', SECRET, NOW)).toBeNull();
  });

  test('asks for refresh only in the last 7 days', () => {
    const exp = NOW + SESSION_TTL_MS;
    expect(needsRefresh(exp, NOW)).toBe(false);
    expect(needsRefresh(exp, exp - 8 * 24 * 60 * 60 * 1000)).toBe(false);
    expect(needsRefresh(exp, exp - 6 * 24 * 60 * 60 * 1000)).toBe(true);
  });
});

describe('parseAllowedIds', () => {
  test('parses a comma-separated list of numeric ids', () => {
    expect(parseAllowedIds(' 86918643, 42 ')).toEqual(new Set([86918643, 42]));
  });

  test('ignores empty and non-numeric entries', () => {
    expect(parseAllowedIds('bear7066,,12x, 7')).toEqual(new Set([7]));
    expect(parseAllowedIds(undefined)).toEqual(new Set());
  });
});

describe('sanitizeReturnTo', () => {
  test('keeps same-site relative paths', () => {
    expect(sanitizeReturnTo('/board/zen?tab=1')).toBe('/board/zen?tab=1');
  });

  test('falls back to root for anything that could leave the site', () => {
    for (const value of [null, '', 'https://evil.example', '//evil.example', '/\\evil.example', 'board/zen', '/\r\nSet-Cookie: x=1']) {
      expect(sanitizeReturnTo(value)).toBe('/');
    }
  });
});

describe('parseCookies', () => {
  test('parses a cookie header', () => {
    expect(parseCookies('a=1; session=abc.def; empty=')).toEqual({ a: '1', session: 'abc.def', empty: '' });
  });

  test('handles a missing header', () => {
    expect(parseCookies(null)).toEqual({});
  });

  test('skips values with broken percent-encoding instead of throwing', () => {
    expect(parseCookies('bad=%E0%A4%A; session=ok')).toEqual({ session: 'ok' });
  });
});
